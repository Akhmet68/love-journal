-- Run this if you created tables earlier (without icon column).
alter table public.events
  add column if not exists icon text not null default '❤';
