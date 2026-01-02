// @lsp-cd ../
* Synthetic fixture for diagnostic false positives testing
* This file mimics the patterns from the original fertility_surveys/dhs/loop.do

***************************************************************
* OPTIONAL PARAMETER: Custom script or program to run
***************************************************************
args custom_arg

* Track if using default (no argument provided)
local is_default = 0

* Detect if argument is a script path or program name
local is_script = 0
if strpos("`custom_arg'", "/") > 0 | strpos("`custom_arg'", ".do") > 0 {
    local is_script = 1
}

* Default to survey.do if no argument
if "`custom_arg'" == "" {
    local custom_arg "subdir/survey.do"
    local is_script = 1
    local is_default = 1
}

if `is_script' == 1 {
    display in white "Using script: `custom_arg'"
}
else {
    display in white "Using program: `custom_arg'"
}

***************************************************************
* HELPER PROGRAM: Execute script or program for a survey
***************************************************************
capture program drop _loop_execute_survey
program define _loop_execute_survey
    args custom_arg is_script country_name survey_year
    
    if `is_script' == 1 {
        do "`custom_arg'" `country_name' `survey_year'
    }
    else {
        `custom_arg' `country_name' `survey_year'
    }
end

// Clear data
clear
clear mata
clear matrix

// Increase max var
set maxvar 10000

/* We need to run this script before we call `confirmdir`, because,
   among other things, it makes sure packages are installed */
run programs.do

// We next make sure the output folders exist
confirmdir "output"
if (_rc == 170) {
    mkdir "output"
}

***********************************************
* Run dataset.do on country dataset files *
***********************************************
* log the data processing:
capture log close testlog
log using "output/test_loop.smcl", name(testlog) replace

_loop_execute_survey "`custom_arg'" `is_script' TestCountry 2020
_loop_execute_survey "`custom_arg'" `is_script' "Another Country" 2019

// Only append and save data when running with default (no custom argument)
// Custom scripts/programs handle their own output
if `is_default' == 1 {
    // Append all the datasets that were just processed: 
    clear
    mata
        stata(sprintf(`"use `"%s"'"', recoded_files[1]))
        for (i=2; i <= rows(recoded_files); i++) {
            stata(sprintf(`"append using `"%s"', force"', recoded_files[i]))
        }
    end
    saveold "output/test.dta", replace version(12) 
}

capture log close _all
