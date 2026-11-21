#!/bin/bash
# Fills every cell of its terminal with a pure green █ (redrawn on a resize),
# so regress.py can see where the cell grid ends: the "padding" scenario.
# On the alternate screen, without wrapping: a resize doesn't reflow the old
# rows into a mess before the redraw.
printf '\e[?1049h\e[?7l'
draw() {
  printf '\e[?25l\e[H\e[2J\e[38;2;0;255;0m'
  local c l row i
  c=$(tput cols) l=$(tput lines)
  row=$(printf '%*s' "$c" '' | sed 's/ /█/g')
  for ((i = 1; i <= l; i++)); do printf '\e[%d;1H%s' "$i" "$row"; done
}
trap draw WINCH
draw
while true; do sleep 1; done
