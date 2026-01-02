program define check_for_bidx
    capture confirm variable bidx, exact  
    if ( _rc == 0 ) {
        di as err "Birth index variable present"
        exit(1)
    }
end
