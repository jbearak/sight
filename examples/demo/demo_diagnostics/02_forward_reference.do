* Demonstration of forward reference warning

clear all

* Macro used before definition - forward reference warning
local result = `total_count' + 10
local total_count = 100
