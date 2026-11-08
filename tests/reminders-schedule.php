<?php
require __DIR__.'/../dist/api/schedule.php';
function check($ok,$label){if(!$ok){fwrite(STDERR,"FAIL: $label\n");exit(1);}}
$r=['at'=>'2026-03-28T08:00:00Z','zone'=>'Europe/Rome','repeat'=>'daily','interval'=>1,'until'=>''];
check(gmdate('c',nextOccurrence($r,strtotime($r['at'])))==='2026-03-29T07:00:00+00:00','DST preserves 09:00 local');
$r['at']='2026-01-31T08:00:00Z';$r['repeat']='monthly';
check(gmdate('Y-m-d',occurrence($r,1))==='2026-02-28','month clamps day');
check(gmdate('Y-m-d',occurrence($r,2))==='2026-03-31','month retains original day');
$r['at']='2024-02-29T08:00:00Z';$r['repeat']='yearly';
check(gmdate('Y-m-d',occurrence($r,1))==='2025-02-28','leap-year clamp');
check(gmdate('Y-m-d',occurrence($r,4))==='2028-02-29','leap-year recovery');
$r['at']='2026-11-06T08:00:00Z';$r['repeat']='weekdays';
check(gmdate('Y-m-d',occurrence($r,1))==='2026-11-09','weekends skipped');
$r['repeat']='weekly';$r['interval']=2;
check(gmdate('Y-m-d',occurrence($r,1))==='2026-11-20','custom interval');
$r['until']='2026-11-19T23:00:00Z';check(occurrence($r,1)===null,'end date');
$r['repeat']='none';check(nextOccurrence($r,strtotime($r['at']))===null,'one-shot finishes');
$r=['at'=>'2000-01-01T09:00:00Z','zone'=>'UTC','repeat'=>'daily','interval'=>1,'until'=>''];
check(nextOccurrence($r,strtotime('2026-11-08T12:00:00Z'))===strtotime('2026-11-09T09:00:00Z'),'long downtime skips historical flood');
echo "PASS: recurrence, DST, leap years, month boundaries, intervals and end dates\n";
