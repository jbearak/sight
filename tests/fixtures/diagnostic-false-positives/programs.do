* programs.do - utility programs for testing
* This file provides global symbols that should be inherited

global test_global_var = 1

capture program drop test_utility_program
program define test_utility_program
    args input_val
    display "Processing: `input_val'"
end

mata
    void aww_init_matrices() {
        // Initialize test matrices
        external string colvector recoded_files
        recoded_files = J(0, 1, "")
    }
end
