* Build the analysis files
version 17
global root "."
cd code
do clean.do 2019 "rural"
include helpers.doh
local wave 3
do "step`wave'.do"
run ../report.do
