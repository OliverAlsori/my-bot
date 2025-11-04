import initSqlJs, { Database as SqlJsDatabase, Statement } from 'sql.js';
import fs from 'fs';
import path from 'path';

const DATA_FILE = path.resolve('data.sqlite');
let db: SqlJsDatabase;

function save() {
  const data = db.export();
  fs.writeFileSync(DATA_FILE, Buffer.from(data));
}

export const ready: Promise<void> = (async () => {
  const SQL = await initSqlJs({});
  if (fs.existsSync(DATA_FILE)) {
    const fileBuffer = fs.readFileSync(DATA_FILE);
    db = new SQL.Database(new Uint8Array(fileBuffer));
  } else {
    db = new SQL.Database();
  }
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      phone TEXT,
      notes TEXT
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('debit','credit')),
      amount REAL NOT NULL CHECK(amount >= 0),
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE CASCADE
    );
  `);
  save();
})();

export type Customer = {
  id: number;
  name: string;
  phone?: string | null;
  notes?: string | null;
};

export type Transaction = {
  id: number;
  customer_id: number;
  kind: "debit" | "credit";
  amount: number;
  note?: string | null;
  created_at: string;
};

function getOne<T = any>(sql: string, params: any[] = []): T | undefined {
  const stmt = db.prepare(sql);
  (stmt as unknown as Statement).bind(params);
  const has = (stmt as unknown as Statement).step();
  if (!has) return undefined;
  const row = (stmt as unknown as Statement).getAsObject() as T;
  stmt.free();
  return row;
}

function getAll<T = any>(sql: string, params: any[] = []): T[] {
  const stmt = db.prepare(sql);
  (stmt as unknown as Statement).bind(params);
  const rows: T[] = [];
  while ((stmt as unknown as Statement).step()) {
    rows.push((stmt as unknown as Statement).getAsObject() as T);
  }
  stmt.free();
  return rows;
}

function run(sql: string, params: any[] = []) {
  const stmt = db.prepare(sql);
  (stmt as unknown as Statement).bind(params);
  (stmt as unknown as Statement).step();
  stmt.free();
}

export async function upsertCustomer(name: string, phone?: string, notes?: string): Promise<Customer> {
  await ready;
  run(`INSERT INTO customers(name, phone, notes) VALUES(?, ?, ?) ON CONFLICT(name) DO UPDATE SET phone=coalesce(excluded.phone, customers.phone), notes=coalesce(excluded.notes, customers.notes)`, [name.trim(), phone ?? null, notes ?? null]);
  const row = getOne<Customer>(`SELECT * FROM customers WHERE name = ?`, [name.trim()])!;
  save();
  return row;
}

export async function getCustomerByName(name: string): Promise<Customer | undefined> {
  await ready;
  return getOne<Customer>(`SELECT * FROM customers WHERE name = ?`, [name.trim()]);
}

export async function addTransaction(customerId: number, kind: "debit"|"credit", amount: number, note?: string): Promise<Transaction> {
  await ready;
  run(`INSERT INTO transactions(customer_id, kind, amount, note) VALUES(?, ?, ?, ?)`, [customerId, kind, amount, note ?? null]);
  const row = getOne<Transaction>(`SELECT * FROM transactions WHERE id = (SELECT MAX(id) FROM transactions)`, [] )!;
  save();
  return row;
}

export async function getCustomerSummary(customerId: number) {
  await ready;
  const totals = getOne<{ total_debit: number | null; total_credit: number | null; balance: number | null }>(
    `SELECT 
       SUM(CASE WHEN kind='debit' THEN amount ELSE 0 END) AS total_debit,
       SUM(CASE WHEN kind='credit' THEN amount ELSE 0 END) AS total_credit,
       COALESCE(SUM(CASE WHEN kind='debit' THEN amount ELSE -amount END), 0) AS balance
     FROM transactions WHERE customer_id = ?`, [customerId]
  )!;
  const recent = getAll<Transaction>(`SELECT * FROM transactions WHERE customer_id = ? ORDER BY id DESC LIMIT 10`, [customerId]);
  return {
    totalDebit: totals?.total_debit ?? 0,
    totalCredit: totals?.total_credit ?? 0,
    balance: totals?.balance ?? 0,
    recent
  };
}

export async function getTotals(range: "today"|"month") {
  await ready;
  const where = range === "today" ? `date(created_at)=date('now')` : `strftime('%Y-%m', created_at)=strftime('%Y-%m','now')`;
  const row = getOne<{ total_debit: number | null; total_credit: number | null }>(
    `SELECT 
       SUM(CASE WHEN kind='debit' THEN amount ELSE 0 END) AS total_debit,
       SUM(CASE WHEN kind='credit' THEN amount ELSE 0 END) AS total_credit
     FROM transactions WHERE ${where}`
  )!;
  return { totalDebit: row?.total_debit ?? 0, totalCredit: row?.total_credit ?? 0 };
}

export async function exportCustomerCSV(customerId: number): Promise<string> {
  await ready;
  const rows = getAll<{id:number; kind:string; amount:number; note:string|null; created_at:string}>(
    `SELECT t.id, t.kind, t.amount, t.note, t.created_at FROM transactions t WHERE t.customer_id = ? ORDER BY t.id`, [customerId]
  );
  const header = "id,kind,amount,note,created_at";
  const body = rows.map(r => [r.id, r.kind, r.amount, r.note ?? "", r.created_at].map(v => `"${String(v).replaceAll('"','""')}"`).join(",")).join("\n");
  return [header, body].join("\n");
}


