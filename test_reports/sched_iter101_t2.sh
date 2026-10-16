#!/bin/bash
# Multi printer: p1 empty + p2 ok -> (40s) both empty -> (60s) p1 ok -> (80s) both quit
cd /app/test_reports
echo empty > /tmp/p1_cmd; echo ok > /tmp/p2_cmd
python fake_printer_iter101.py 300 device_token /tmp/p1_cmd > /tmp/p1_c.log 2>&1 &
python fake_printer_iter101.py 300 device_token2 /tmp/p2_cmd > /tmp/p2_c.log 2>&1 &
echo "start $(date +%T)" > /tmp/sched2.log
sleep 40; echo empty > /tmp/p2_cmd; echo "both empty $(date +%T)" >> /tmp/sched2.log
sleep 20; echo ok > /tmp/p1_cmd; echo "p1 ok $(date +%T)" >> /tmp/sched2.log
sleep 20; echo quit > /tmp/p1_cmd; echo quit > /tmp/p2_cmd; echo "quit $(date +%T)" >> /tmp/sched2.log
