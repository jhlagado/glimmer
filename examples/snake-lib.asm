; Snake support module — hand-written AZM, brought into the program
; with Glimmer's import statement. @ marks the exported API; plain
; labels and the scratch bytes stay private to this unit.
;
; Positions are packed y*8+x (0..63). The module reads the program's
; Body ring, HeadIdx, and Len cells directly, and draws through the
; generated profile library (FbPlot, COLOR_*).

; Test whether a packed position is occupied by the snake body:
; scans Len cells backwards from HeadIdx. Preserves D so callers can
; carry a position across the call.
.routine in A out carry,zero clobbers A,BC,E,HL,sign,parity,halfCarry
@BodyContains:
        ld      e,a
        ld      a,(Len)
        or      a
        jr      z,_none
        ld      b,a
        ld      a,(HeadIdx)
        ld      c,a
_scan:
        ld      hl,Body
        ld      a,l
        add     a,c
        ld      l,a
        ld      a,h
        adc     a,0
        ld      h,a
        ld      a,(hl)
        cp      e
        jr      z,_hit
        ld      a,c
        dec     a
        and     %00111111
        ld      c,a
        djnz    _scan
_none:
        or      a
        ret
_hit:
        scf
        ret

; Plot one packed position. A = position, D = colour bits.
.routine in A,D clobbers A,BC,DE,HL,carry,zero,sign,parity,halfCarry
@PlotPos:
        ld      e,a
        and     %00000111
        ld      b,a
        ld      a,e
        rrca
        rrca
        rrca
        and     %00000111
        ld      c,a
        ld      a,d
        call    FbPlot
        ret

; Draw the whole body: Len cells backwards from HeadIdx in green,
; then the head again in white (FbPlot ORs, so white wins).
.routine clobbers A,BC,DE,HL,carry,zero,sign,parity,halfCarry
@DrawBody:
        ld      a,(Len)
        or      a
        ret     z
        ld      (SnakeDrawCnt),a
        ld      a,(HeadIdx)
        ld      (SnakeDrawIdx),a
_loop:
        ld      hl,Body
        ld      a,(SnakeDrawIdx)
        add     a,l
        ld      l,a
        ld      a,h
        adc     a,0
        ld      h,a
        ld      a,(hl)
        ld      d,COLOR_GREEN
        call    PlotPos
        ld      a,(SnakeDrawIdx)
        dec     a
        and     %00111111
        ld      (SnakeDrawIdx),a
        ld      a,(SnakeDrawCnt)
        dec     a
        ld      (SnakeDrawCnt),a
        jr      nz,_loop
        ld      hl,Body
        ld      a,(HeadIdx)
        add     a,l
        ld      l,a
        ld      a,h
        adc     a,0
        ld      h,a
        ld      a,(hl)
        ld      d,COLOR_WHITE
        call    PlotPos
        ret

; Private scratch for the draw loop.
SnakeDrawCnt:
        .db     0
SnakeDrawIdx:
        .db     0
