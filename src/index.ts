import 'dotenv/config';
import { Telegraf, session } from 'telegraf';
import type { Context } from 'telegraf';
import { ready, addTransaction, exportCustomerCSV, getCustomerByName, getCustomerSummary, getTotals, upsertCustomer } from './db.js';

type FlowState = {
  step?: 'name'|'kind'|'amount'|'note';
  name?: string;
  kind?: 'debit'|'credit';
  amount?: number;
};

type SessionData = { flow?: FlowState };
type BotContext = Context & { session: SessionData };

if (!process.env.BOT_TOKEN) {
  console.error('BOT_TOKEN مفقود في .env');
  console.log('Working directory:', process.cwd());
  console.log('ENV BOT_TOKEN present?', !!process.env.BOT_TOKEN);
  process.exit(1);
}
console.log('ENV loaded. BOT_TOKEN prefix:', (process.env.BOT_TOKEN ?? '').slice(0, 6) + '***');
const bot = new Telegraf<BotContext>(process.env.BOT_TOKEN!);
bot.use(session({ defaultSession: (): SessionData => ({}) }));

// Debug logging middleware
bot.use(async (ctx, next) => {
  try {
    const txt = (ctx.message as any)?.text;
    console.log('update:', ctx.updateType, txt || '');
  } catch {}
  return next();
});

function t(str: string) { return str; }

bot.start(async (ctx) => {
  await ctx.reply(t('مرحباً! أنا بوت محاسبة. الأوامر المتاحة:\n') +
    '/add - إضافة قيد جديد\n' +
    '/customer اسم - معلومات زبون\n' +
    '/sum اليوم|الشهر - المجاميع\n' +
    '/export اسم - تصدير CSV');
});

bot.command('ping', async (ctx) => {
  await ctx.reply('pong');
});

bot.command('add', async (ctx) => {
  ctx.session.flow = { step: 'name' };
  await ctx.reply('اكتب اسم الزبون:');
});

bot.hears(/^\s*\/customer\s+(.+)/i, async (ctx) => {
  const name = (ctx.match as RegExpMatchArray)[1].trim();
  const c = await getCustomerByName(name);
  if (!c) return ctx.reply('لم أجد الزبون.');
  const s = await getCustomerSummary(c.id);
  const recent = s.recent.map(r => `#${r.id} ${r.kind==='debit'?'مدين':'دائن'} ${r.amount} — ${r.note??''} — ${r.created_at}`).join('\n');
  await ctx.reply(`الاسم: ${c.name}\nالرصيد: ${s.balance}\nالمدين: ${s.totalDebit}\nالدائن: ${s.totalCredit}\nآخر القيود:\n${recent || 'لا يوجد'}`);
});

bot.hears(/^\s*\/sum\s+(اليوم|الشهر)/i, async (ctx) => {
  const range = /اليوم/i.test((ctx.match as RegExpMatchArray)[1]) ? 'today' : 'month';
  const tts = await getTotals(range as 'today'|'month');
  await ctx.reply(`المجاميع (${range==='today'?'اليوم':'هذا الشهر'}):\nمدين: ${tts.totalDebit}\nدائن: ${tts.totalCredit}`);
});

bot.hears(/^\s*\/export\s+(.+)/i, async (ctx) => {
  const name = (ctx.match as RegExpMatchArray)[1].trim();
  const c = await getCustomerByName(name);
  if (!c) return ctx.reply('لم أجد الزبون.');
  const csv = await exportCustomerCSV(c.id);
  await ctx.replyWithDocument({ source: Buffer.from(csv, 'utf8'), filename: `${c.name}.csv` });
});

bot.on('text', async (ctx) => {
  const flow = ctx.session.flow;
  const text = ctx.message.text.trim();
  if (!flow || !flow.step) return;

  if (flow.step === 'name') {
    flow.name = text;
    flow.step = 'kind';
    await ctx.reply('نوع القيد؟ اكتب: مدين أو دائن');
    return;
  }

  if (flow.step === 'kind') {
    const k = /مدين|debit/i.test(text) ? 'debit' : /دائن|credit/i.test(text) ? 'credit' : undefined;
    if (!k) return ctx.reply('اكتب مدين أو دائن');
    flow.kind = k as 'debit'|'credit';
    flow.step = 'amount';
    await ctx.reply('القيمة؟ مثال: 150.75');
    return;
  }

  if (flow.step === 'amount') {
    const amount = Number(text.replace(/,/g, '.'));
    if (!Number.isFinite(amount) || amount <= 0) return ctx.reply('أدخل رقم صحيح أكبر من صفر');
    flow.amount = amount;
    flow.step = 'note';
    await ctx.reply('ملاحظة (اختياري). اكتب - لتخطي');
    return;
  }

  if (flow.step === 'note') {
    const name = flow.name!;
    const kind = flow.kind!;
    const amount = flow.amount!;
    const note = text === '-' ? undefined : text;
    const c = await upsertCustomer(name);
    await addTransaction(c.id, kind, amount, note);
    ctx.session.flow = {};
    const s = await getCustomerSummary(c.id);
    await ctx.reply(`تم الحفظ ✅\n${c.name}: الرصيد الآن ${s.balance}`);
    return;
  }
});

bot.catch((err, ctx) => {
  console.error('Bot error', err);
  ctx.reply('حدث خطأ غير متوقع.');
});

await ready;
bot.launch().then(async () => {
  try {
    const me = await bot.telegram.getMe();
    console.log('Bot started as @' + me.username);
  } catch (e) {
    console.log('Bot started');
  }
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));


