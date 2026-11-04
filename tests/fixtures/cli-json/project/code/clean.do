use "$root/raw/survey.dta", clear
bysort hhid (pid): gen n = _n
gen double inc_pc = income / hhsize if !missing(income) // per capita
egen tot = rowtotal(a-c)
reg y x i.region [pw=wt] in 1/100, vce(cluster hhid)
#delimit ;
keep if age >= 18
    & sex == 1;
#delimit cr
local files : dir "." files "*.dta"
foreach f of local files {
    append using "`f'"
}
forvalues i = 1(2)9 {
    replace x`i' = .a if x`i' < 0
}
