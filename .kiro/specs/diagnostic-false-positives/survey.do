/*
  FILE:         survey.do
  PURPOSE:      Process DHS survey data by merging birth history and women's 
                files (when applicable) and constructing analytical variables.
                This is the script that is called by loop.do to process each survey in the DHS dataset individually.
*/

// @lsp-global aww_programs_are_ready
// @lsp-global metadata_for_dhs_checks_is_ready

***************************************************************
* 1. SET UP AND INITIALIZATION
***************************************************************

* Extract survey identifiers that are passed from loop.do (country name and survey year)
local country_name `1'
local survey_year `2'
local dataset_name `country_name' `survey_year'
global dataset_name `dataset_name'

* Display the survey being processed
display in white "Processing dataset: `country_name' `survey_year'"

/*  Confirm that the programs script has been run; as it contains custom functions 
    and macros that we will need in this script. If we called this script outside of loop.do
    that might not be the case. 
*/
if ( "${aww_programs_are_ready}" != "1" ) {
    * If we have not run programs.do, then we need to:
    run programs.do
}

/*  Confirm that the metadata for processing the survey checks has been prepped
    this might not be the case if we called this script by itself, i.e., outside 
    the context of loop.do
*/
if ( "${metadata_for_dhs_checks_is_ready}" != "1" ) {
    * If the metadata is not ready, then we need to prep it:
    include dhs/import_metadata_for_survey_checks.do
}


***************************************************************
* 2. DEFINE HELPER PROGRAM FOR DATA VALIDATION
***************************************************************
/*  We run the check below when we first read in the woman-level file.
    It confirms that we are working with the right file type. If the
    birth index variable (bidx) is present, then we are working with a
    birth history file instead of a woman-level file, which is an error.
*/
capture program drop check_for_bidx_in_wm_file
program define check_for_bidx_in_wm_file
    * Confirm that bidx does not exist to verify that this is a wm file 
    capture confirm variable bidx, exact  
    if ( _rc == 0 ) {
        di as err `"Birth index variable present in wm file'" 
        exit(1)
    }
end



***************************************************************
* 3. LOAD AND PROCESS FILES
***************************************************************

***************************************************************
* 3a. Load WM file into default frame (always needed)
***************************************************************
aww_use `country_name' `survey_year', dhs women clear checksig
check_for_bidx_in_wm_file
rename *, lower

* Clean up caseid variable (remove leading/trailing spaces)
capture confirm variable caseid
if (_rc == 0) {
    replace caseid = strtrim(stritrim(caseid))
}

/*  Special handling for Congo (Brazzaville) 2005: drop problematic variable
    Variable s705 causes merge error due to type mismatch between bh and wm files
*/
capture confirm variable s705, exact
if (_rc == 0) {
    drop s705
}

***************************************************************
* 3b. Attempt to load BH file into frame and check for intention vars
***************************************************************
local has_bh = 0
local bh_has_intention = 0

capture frame drop bh
frame create bh

capture frame bh: aww_use `country_name' `survey_year', dhs births clear checksig
if (_rc == 0) {
    frame bh {
        /*  Special handling for Armenia 2000: fix mismatched variable
            labels between wm and bh files
        */
        if "`country_name'" == "Armenia" & "`survey_year'" == "2000" {
            label values m10 LABAN
            label values m18 LABAS
        }
        
        rename *, lower
        
        * Confirm that bidx exists to verify that this is a bh file
        capture confirm variable bidx, exact
        if (_rc != 0) {
            di as err `"Birth index variable not present in bh file'"
            exit(1)
        }
        
        * Store all raw variable names in the bh file
        unab raw_vars_bh: _all
        
        * Check if birth history file contains intention variables
        local intention_vars v367
        foreach my_var in `intention_vars' {
            capture confirm variable `my_var', exact
            if (_rc == 0) {
                local bh_has_intention = 1
            }
        }
    }
    
    local has_bh = 1
}

***************************************************************
* 3c. Decide processing path
***************************************************************
if (`has_bh' == 1 & `bh_has_intention' == 1) {
    *******************************************************************
    * Path A: Merge BH + WM files using bh_merge
    *******************************************************************
    
    * Identify merge variables from the births frame
    local merge_vars
    
    * Clean up caseid variable in bh frame (remove leading/trailing spaces)
    frame bh {
        capture confirm variable caseid
        if (_rc == 0) {
            replace caseid = strtrim(stritrim(caseid))
        }
        
        foreach my_var in v001 v002 v003 caseid {
            capture confirm variable `my_var'
            if (_rc == 0) {
                local merge_vars `merge_vars' `my_var'
            }
        }
    }
    
    * Validate merge vars exist in WM (default) frame and handle special cases
    unab all_vars_in_woman: _all
    local merge_vars : list merge_vars & all_vars_in_woman
    
    /*  For Dominican Republic 1991 and Sri Lanka 1987, there are duplicate women.
        Drop these so the merge works properly.
    */
    if "`country_name'" == "Dominican Republic" & "`survey_year'" == "1991" {
        duplicates drop `merge_vars', force
    }
    if "`country_name'" == "Sri Lanka" & "`survey_year'" == "1987" {
        duplicates drop `merge_vars', force
    }
    
    * Verify all merge variables exist
    foreach my_var in `merge_vars' {
        capture confirm variable `my_var'
        if (_rc != 0) {
            display as error "ERROR: Merge variable `my_var' missing in WM file for `country_name' `survey_year'"
            exit(1)
        }
    }
    
    * Validate that we have either caseid or the full v001 v002 v003 combination
    local has_caseid : list posof "caseid" in merge_vars
    local has_v001   : list posof "v001" in merge_vars
    local has_v002   : list posof "v002" in merge_vars
    local has_v003   : list posof "v003" in merge_vars
    
    local has_full_combo = (`has_v001' > 0) & (`has_v002' > 0) & (`has_v003' > 0)
    
    if (`has_caseid' == 0) & (`has_full_combo' == 0) {
        di as err "ERROR: Insufficient merge variables for `country_name' `survey_year'"
        di as err "  Found merge vars: `merge_vars'"
        di as err "  Required: caseid OR full combination of v001 v002 v003"
        exit 1
    }
    
    * Perform the merge using bh_merge: WM in default, BH in bh frame
    bh_merge `merge_vars', bh(bh)
    capture frame drop bh
}
else {
    *******************************************************************
    * Path B: Use WM data only (no BH or BH lacks intention vars)
    *******************************************************************
    capture frame drop bh
    
    * Create _merge variable to indicate no merge occurred
    capture confirm variable _merge
    if (_rc != 0) {
        gen byte _merge = 0
        capture label drop _merge
        label define _merge 0 "No Merge Occurred" 1 "WM only" 2 "BH only" 3 "Matched"
        label values _merge _merge
    }
    
    * Reset has_bh since we're not using BH data
    local has_bh = 0
}

***************************************************************
* 5. STORE RAW VARIABLE NAMES
***************************************************************

* Store the names of the raw variables in a local
* This is so that later, we can choose to retain only the constructed vars
* and selected raw variables
unab raw_vars: _all


***************************************************************
* 6. PERFORM YEAR RECODES FOR SPECIFIC SURVEYS
***************************************************************

* Perform year recodes for Afghanistan, Ethiopia & Nepal surveys
* These surveys require special date adjustments
include dhs/year_recodes

***************************************************************
* 7. CONSTRUCT WOMEN-LEVEL VARIABLES
***************************************************************
/* Recode the data, starting with variables that can be constructed with just 
   the woman-level file 
*/
include dhs/wm_vars


***************************************************************
* 8. CONSTRUCT BIRTH HISTORY VARIABLES
***************************************************************
* Store constructed women's variables if we performed a BH merge

if ( `has_bh' == 1 ) {
	unab all_vars_wm: _all
    local constructed_vars_wm: list all_vars_wm - raw_vars 
} 

/* If has_bh == 0, then the bh_vars are constructed using information 
   stored in the woman-level file. This is because the woman-level file 
   can contain variables describing the most recent birth.
*/

* Construct birth history variables (birth spacing, parity, intention, etc.)

include dhs/bh_vars.do

***************************************************************
* 9. PREPARE FINAL VARIABLE LIST TO KEEP IN THE DATASET
***************************************************************

* Before we save the recoded dataset, let's retain only the variables we need
* This reduces file size and processing time for subsequent analyses

* Get complete list of all variables after construction
unab all_vars: _all

* Create a local of constructed vars by subtracting raw vars from all vars
local constructed_vars: list all_vars - raw_vars

* Include the list of raw variables to retain
include dhs/raw_vars_to_retain.do

* Check which of the raw_vars_to_retain exist in the present dataset
* (Not all surveys have all variables)    
local raw_vars_to_retain : list all_vars & raw_vars_to_retain 

* Keep only constructed variables and selected raw variables
keep `constructed_vars' `raw_vars_to_retain' 


***************************************************************
* 10. SAVE FINAL PROCESSED DATASET
***************************************************************
* Add survey identifiers to the dataset for later use in merging and analysis    
generate country_name = "`country_name'"
generate survey_year  = `survey_year'

* Perform survey-specific data quality checks
* See note toward the top of loop.do for details on these checks
include dhs/survey_checks.do 

* Generate survey identifier (combination of country and year)
sgen     survey       = "`dataset_name'" 

* Create output directories if they do not exist
capture  mkdir          "output"
capture  mkdir          "output/Intention Recode Data"
capture  mkdir          "output/Intention Recode Data/DHS"

* Save processed dataset to the output directory with a name that includes the survey identifiers
local    recoded_path  `"output/Intention Recode Data/DHS/`dataset_name' intentionrecode.dta"'
save  `"`recoded_path'"', replace

* Add the path of the recoded file to the list of recoded files for DHS surveys
* This is used by loop.do to track which surveys have been processed
mata: recoded_files_dhs = recoded_files_dhs \ st_local("recoded_path")

display in green "Survey processing completed: `country_name' `survey_year'"