* Demonstration of intelligent autocomplete

sysuse auto, clear

* Command completion - type "sum" and see suggestions
* [Type "sum" and pause to show dropdown]


* Variable completion - LSP knows what's in your dataset
* [Type "gen new = m" and show mpg, make appear]

* Macro completion - type backtick and local name
local fruit "apple banana cherry"
local color "red blue green"

* [Type "display `f" or "`c"]

* Option completion for commands
* [Type "summarize, " and show options like "detail"]
summarize,

* option completion is imperfect 
* it does not yet have all possibilities in its current database
* however, it scans user-written programs, in addition to built-ins

* Global macro completion
global project_root "/Users/me/project"
global data_folder "$project_root/data"

* [Type "$pr" and see project_root, then "$data" and see data_folder]
