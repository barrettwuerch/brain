-- 0025_challenge_calibration_reports.sql
-- Persistent monthly calibration reporting (desk/regime breakdown)

create table if not exists public.challenge_calibration_reports (
  id uuid primary key default gen_random_uuid(),
  report_month date not null, -- first day of month
  desk text not null,
  regime text not null,
  n_strategies int not null,
  mean_brier_score numeric(10,8),
  created_at timestamptz not null default now(),
  unique (report_month, desk, regime)
);

create index if not exists idx_calib_reports_month on public.challenge_calibration_reports(report_month);
create index if not exists idx_calib_reports_desk on public.challenge_calibration_reports(desk);
