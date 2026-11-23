#!/bin/bash
# A pretend agent: reports each state typed to it (working, blocked, idle) as
# an agent does (OSC 7501), and keeps running: the core drops a report as soon
# as the program that made it is gone.
while read -r state; do printf '\e]7501;state=%s\a' "$state"; done
