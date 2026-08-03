create table if not exists public.loans (
  id text primary key,
  name text not null,
  lender text not null default '',
  loan_type text not null default 'other' check (loan_type in ('card', 'personal', 'other')),
  original_amount bigint not null default 0 check (original_amount >= 0),
  balance bigint not null default 0 check (balance >= 0),
  interest_rate numeric(6, 3) not null default 0 check (interest_rate >= 0),
  monthly_payment bigint not null default 0 check (monthly_payment >= 0),
  next_payment_date date,
  notes text,
  color text not null default '#f97316',
  created_at timestamptz not null default now()
);

create table if not exists public.loan_payments (
  id text primary key,
  loan_id text not null references public.loans(id) on delete cascade,
  amount bigint not null check (amount > 0),
  paid_at date not null,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists loan_payments_loan_id_idx on public.loan_payments(loan_id);
create index if not exists loan_payments_paid_at_idx on public.loan_payments(paid_at desc);
