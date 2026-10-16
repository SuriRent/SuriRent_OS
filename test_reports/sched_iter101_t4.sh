#!/bin/bash
# Short: p1 low -> quit (30s) -> reconnect low (55s)
cd /app/test_reports
echo low > /tmp/p1_cmd
python fake_printer_iter101.py 200 device_token /tmp/p1_cmd > /tmp/p1_f.log 2>&1 &
sleep 40; echo quit > /tmp/p1_cmd; echo "quit $(date +%T)" > /tmp/sched4.log
sleep 25; echo low > /tmp/p1_cmd
python fake_printer_iter101.py 200 device_token /tmp/p1_cmd > /tmp/p1_g.log 2>&1 &
echo "reconnect $(date +%T)" >> /tmp/sched4.log
