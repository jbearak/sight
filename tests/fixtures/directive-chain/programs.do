* programs.do - utility programs at root level
* This file should be found when working directory is set to root

global programs_loaded = 1

capture program drop utility_program
program define utility_program
    args input_val
    display "Utility: `input_val'"
end
