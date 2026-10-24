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
}

export interface Profile {
  id: string;
  email: string | null;
  display_name: string | null;
}

export interface Member {
  account_id: string;
  user_id: string;
}

export type Table = 'accounts' | 'categories' | 'transactions' | 'recurring';
export interface TableRow {
  accounts: Account;
  categories: Category;
  transactions: Tx;
  recurring: Recurring;
}
