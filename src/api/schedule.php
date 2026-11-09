<?php
// Calendar recurrences keep their original local wall-clock time across DST.
function occurrence(array $r, int $n): ?int {
    $base = (new DateTimeImmutable($r['at']))->setTimezone(new DateTimeZone($r['zone']));
    $step = $r['interval'];
    if ($r['repeat'] === 'none' && $n > 0) return null;
    if ($n === 0) $date = $base;
    elseif ($r['repeat'] === 'daily') $date = $base->modify('+' . ($n*$step) . ' days');
    elseif ($r['repeat'] === 'weekly') $date = $base->modify('+' . ($n*$step) . ' weeks');
    elseif ($r['repeat'] === 'weekdays') {
        // First occurrence is the chosen date; later occurrences are weekdays.
        $date = $base->modify('+' . ($n*$step) . ' weekdays');
    } else {
        $months = $n*$step*($r['repeat'] === 'yearly' ? 12 : 1);
        $date = $base->modify('first day of this month')->modify("+$months months");
        $date = $date->setDate((int)$date->format('Y'), (int)$date->format('m'), min((int)$base->format('d'), (int)$date->format('t')));
    }
    $at = $date->getTimestamp();
    return !empty($r['until']) && $at > strtotime($r['until']) ? null : $at;
}
function nextOccurrence(array $r, int $after): ?int {
    if ($r['repeat'] === 'none') { $first=occurrence($r,0); return $first !== null && $first>$after ? $first : null; }
    // Binary search avoids traversing years of missed daily occurrences.
    $lo=0; $hi=1;
    while ($hi<65536 && ($v=occurrence($r,$hi))!==null && $v<=$after) $hi*=2;
    while ($lo<$hi) { $mid=intdiv($lo+$hi,2); $v=occurrence($r,$mid); if ($v===null || $v>$after) $hi=$mid; else $lo=$mid+1; }
    return occurrence($r,$lo);
}
