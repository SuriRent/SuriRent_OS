#!/bin/bash
# Admin kiosk: p1 low -> quit (60s) -> reconnect ok (95s)
cd /app/test_reports
echo low > /tmp/p1_cmd
python fake_printer_iter101.py 240 device_token /tmp/p1_cmd > /tmp/p1_d.log 2>&1 &
echo "start $(date +%T)" > /tmp/sched3.log
sleep 60; echo quit > /tmp/p1_cmd; echo "quit $(date +%T)" >> /tmp/sched3.log
sleep 35; echo ok > /tmp/p1_cmd
python fake_printer_iter101.py 200 device_token /tmp/p1_cmd > /tmp/p1_e.log 2>&1 &
echo "reconnect $(date +%T)" >> /tmp/sched3.log
