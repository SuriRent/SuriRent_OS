#!/bin/bash
# Timeline for offline test: low -> quit(55s) -> reconnect low (85s) -> ok (105s)
cd /app/test_reports
echo low > /tmp/p1_cmd
python fake_printer_iter101.py 300 device_token /tmp/p1_cmd > /tmp/p1_a.log 2>&1 &
echo "start $(date +%T)" > /tmp/sched1.log
sleep 55; echo quit > /tmp/p1_cmd; echo "quit $(date +%T)" >> /tmp/sched1.log
sleep 30; echo low > /tmp/p1_cmd
python fake_printer_iter101.py 300 device_token /tmp/p1_cmd > /tmp/p1_b.log 2>&1 &
echo "reconnect $(date +%T)" >> /tmp/sched1.log
sleep 20; echo ok > /tmp/p1_cmd; echo "ok $(date +%T)" >> /tmp/sched1.log
