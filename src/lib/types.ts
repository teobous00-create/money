export type TxType = 'expense' | 'income' | 'transfer';
export type CatType = 'expense' | 'income';
export type AccountKind = 'regular' | 'credit' | 'savings';
export type Freq = 'weekly' | 'monthly' | 'yearly';

interface Row {
  id: string;
  owner_id: string;
  updated_at?: string;
  deleted_at?: string | null;
}

export interface Account extends Row {
  name: string;
  kind: AccountKind;
  icon: string;
  color: string;
  opening_balance: number;
  credit_limit: number | null;
  goal: number | null;
  archived: boolean;
  sort: number;
}

export interface Category extends Row {
  type: CatType;
  name: string;
  parent_id: string | null;
  icon: string;
  color: string;
  sort: number;
  archived: boolean;
}

export interface Tx extends Row {
  type: TxType;
  date: string; // YYYY-MM-DD
  amount: number;
  account_id: string;
  to_account_id: string | null;
  category_id: string | null;
  note: string | null;
  recurring_id: string | null;
  seq: number;
  created_at?: string;
  virtual?: boolean; // client-only: a future occurrence projected from a recurring rule
}

export interface Recurring extends Row {
  type: TxType;
  amount: number;
  account_id: string;
  to_account_id: string | null;
  category_id: string | null;
  note: string | null;
  freq: Freq;
  anchor_day: number;
  next_date: string;
  active: boolean;
  end_date: string | null;
  skip_dates: string[];
}

export interface Profile {
  id: string;
  email: string | null;
  display_name: string | null;
}

export interface Member {
  category_id: string; // top-level category
  user_id: string;
}

export interface Person extends Profile {
  is_owner: boolean;
}

// ---------- personal tracker (work + trading), private to the owner ----------

export interface JobRate { from: string; day?: number; bonus?: number; hour?: number; min?: number }   // daily jobs: bonus = € per contact; min = average contacts per day needed for the month's bonus

export interface Job extends Row {
  name: string;
  kind: 'daily' | 'hourly';           // daily: day rate + bonus per sale · hourly: hourly rate (+ tips)
  pay: 'monthly' | 'semimonthly';     // semimonthly: 1–15 and 16–end
  rates: JobRate[];
  color: string;
  salary_category_id: string | null;  // where pay-outs are recorded as income
  bonus_category_id: string | null;   // daily jobs: where the sales bonus is recorded
  tips_category_id: string | null;
  tips_account_id: string | null;
  sort: number;
  archived: boolean;
}

export interface Shift extends Row {    // id = `${job_id}:${date}`
  job_id: string;
  date: string;
  hours: number;
  sales: number;                      // daily jobs with a contacts target: contacts that day
  base?: number | null;               // daily jobs: what the day paid (defaults to the day rate)
  bonus?: number | null;              // daily jobs: bonus earned that day, in €
  tips_tx_id: string | null;
}

export interface Payout extends Row {   // id = `${job_id}:${period_start}`
  job_id: string;
  period_start: string;
  period_end: string;
  amount: number;                     // salary part received
  bonus: number;                      // bonus part received
  tx_id: string | null;
  bonus_tx_id: string | null;
  settled?: boolean;                  // period paid in full (amount unknown, e.g. paid before using the app)
  date: string;
}

export interface Strategy extends Row {
  name: string;
  color: string;
  goal: number | null;                // monthly goal
  sort: number;
  archived: boolean;
}

export interface Pnl extends Row {      // id = `${strategy_id}:${date}`
  strategy_id: string;
  date: string;
  pnl: number;
}

export type Table = 'accounts' | 'categories' | 'transactions' | 'recurring' | 'jobs' | 'shifts' | 'payouts' | 'strategies' | 'pnl';
export interface TableRow {
  accounts: Account;
  categories: Category;
  transactions: Tx;
  recurring: Recurring;
  jobs: Job;
  shifts: Shift;
  payouts: Payout;
  strategies: Strategy;
  pnl: Pnl;
}

/** Personal settings, private to each user. */
export interface Prefs {
  analytics?: boolean;
  budgets?: Record<string, number>; // category id → monthly limit
  tipsCats?: string[];              // category ids counted as tips (empty/undefined = automatic)
  favorites?: Favorite[];           // one-tap entries on Transactions
  aboutMe?: string;                 // "About me": goals and situation, sent to the AI
  reviews?: Record<string, Review>; // 'YYYY-MM' → monthly review written by the AI
  aiUsage?: { day: string; count: number }; // written by the server only
  goals?: Record<string, number>;   // goal categories: id → target € (0 = no target); still expenses, with progress
  tradingAccounts?: string[];      // account ids that hold trading capital (not counted as your cash until withdrawn)
  lastLevel?: number;              // the level last celebrated
  homeSeeded?: number;              // household budgets taken from the Excel (version)
  learned?: Record<string, string>;  // a word you said → the category you corrected it to (voice / quick entry)
}

export interface Review { text: string; upTo: string; at: string; v?: number }

export interface Favorite {
  id: string;
  type: TxType;
  amount: number;
  account_id: string;
  to_account_id: string | null;
  category_id: string | null;
  note: string | null;
}
