; Tetro support module — hand-written AZM, brought into the program
; with Glimmer's import statement. Piece tables and the collision /
; lock / clear engine, adapted from corpus/tetro (0BSD). @ labels are
; the module's API; the data tables and scratch above the first @ stay
; private to this unit.
;
; Conventions (as corpus): a piece is 4 row bytes, MSB-left (bit 7 is
; column 0), stored unshifted; the X position shifts rows right at
; probe/draw time. The board is four 8-byte planes in program state:
; BoardRows (occupancy) + BoardRed/BoardGreen/BoardBlue.

; --- piece data (file-level: private to this module) ---

PieceIR0:
        .db     %00000000
        .db     %11100000
        .db     %00000000
        .db     %00000000
PieceIR1:
        .db     %10000000
        .db     %10000000
        .db     %10000000
        .db     %00000000
PieceIR2        .equ PieceIR0
PieceIR3        .equ PieceIR1

PieceOR0:
        .db     %11000000
        .db     %11000000
        .db     %00000000
        .db     %00000000
PieceOR1        .equ PieceOR0
PieceOR2        .equ PieceOR0
PieceOR3        .equ PieceOR0

PieceTR0:
        .db     %11100000
        .db     %01000000
        .db     %00000000
        .db     %00000000
PieceTR1:
        .db     %10000000
        .db     %11000000
        .db     %10000000
        .db     %00000000
PieceTR2:
        .db     %00000000
        .db     %01000000
        .db     %11100000
        .db     %00000000
PieceTR3:
        .db     %01000000
        .db     %11000000
        .db     %01000000
        .db     %00000000

PieceSR0:
        .db     %11000000
        .db     %01100000
        .db     %00000000
        .db     %00000000
PieceSR1:
        .db     %01000000
        .db     %11000000
        .db     %10000000
        .db     %00000000
PieceSR2:
        .db     %00000000
        .db     %11000000
        .db     %01100000
        .db     %00000000
PieceSR3        .equ PieceSR1

PieceZR0:
        .db     %01100000
        .db     %11000000
        .db     %00000000
        .db     %00000000
PieceZR1:
        .db     %10000000
        .db     %11000000
        .db     %01000000
        .db     %00000000
PieceZR2:
        .db     %00000000
        .db     %01100000
        .db     %11000000
        .db     %00000000
PieceZR3        .equ PieceZR1

PieceJR0:
        .db     %00100000
        .db     %11100000
        .db     %00000000
        .db     %00000000
PieceJR1:
        .db     %10000000
        .db     %10000000
        .db     %11000000
        .db     %00000000
PieceJR2:
        .db     %00000000
        .db     %11100000
        .db     %10000000
        .db     %00000000
PieceJR3:
        .db     %11000000
        .db     %01000000
        .db     %01000000
        .db     %00000000

PieceLR0:
        .db     %10000000
        .db     %11100000
        .db     %00000000
        .db     %00000000
PieceLR1:
        .db     %11000000
        .db     %10000000
        .db     %10000000
        .db     %00000000
PieceLR2:
        .db     %00000000
        .db     %11100000
        .db     %00100000
        .db     %00000000
PieceLR3:
        .db     %01000000
        .db     %01000000
        .db     %11000000
        .db     %00000000

PiecePtrTable:
        .dw     PieceIR0, PieceIR1, PieceIR2, PieceIR3
        .dw     PieceOR0, PieceOR1, PieceOR2, PieceOR3
        .dw     PieceTR0, PieceTR1, PieceTR2, PieceTR3
        .dw     PieceSR0, PieceSR1, PieceSR2, PieceSR3
        .dw     PieceZR0, PieceZR1, PieceZR2, PieceZR3
        .dw     PieceJR0, PieceJR1, PieceJR2, PieceJR3
        .dw     PieceLR0, PieceLR1, PieceLR2, PieceLR3

; Rightmost occupied column per (piece, rotation): X may run up to
; 7 - right. Same order as PiecePtrTable.
PieceRightTbl:
        .db     2,0,2,0
        .db     1,1,1,1
        .db     2,1,2,1
        .db     2,1,2,1
        .db     2,1,2,1
        .db     2,1,2,1
        .db     2,1,2,1

; Colour plane bits per piece (COLOR_* masks from the generated file).
PieceColorTbl:
        .db     COLOR_CYAN                        ; I
        .db     COLOR_WHITE                       ; O
        .db     COLOR_MAGENTA                     ; T
        .db     COLOR_GREEN                       ; S
        .db     COLOR_RED                         ; Z
        .db     COLOR_BLUE                        ; J
        .db     COLOR_YELLOW                      ; L

; Score delta per line-clear count; counts >= 4 clamp to the tetris.
ClearScoreTbl:
        .dw     0, 100, 300, 500, 800

; The four board planes, for the collapse loop.
BoardPlaneTbl:
        .dw     BoardRows, BoardRed, BoardGreen, BoardBlue

; Module scratch.
CurPiecePtr:
        .dw     0
CurPieceRight:
        .db     0
CurColorBits:
        .db     0
ShiftCount:
        .db     0

; --- routines ---

; Recompute the piece pointer, right bound, and colour bits from the
; program's CurPieceIndex and CurRotation cells. Call after either
; changes.
;! clobbers A,C,DE,HL,F
@SetCurPiece:
        ld      a,(CurPieceIndex)
        add     a,a
        add     a,a                  ; index*4
        ld      c,a
        ld      a,(CurRotation)
        and     %00000011
        add     a,c                  ; table index
        ld      e,a
        ld      d,0
        ld      hl,PieceRightTbl
        add     hl,de
        ld      a,(hl)
        ld      (CurPieceRight),a
        ld      a,e
        add     a,a                  ; *2: word table
        ld      e,a
        ld      hl,PiecePtrTable
        add     hl,de
        ld      a,(hl)
        inc     hl
        ld      h,(hl)
        ld      l,a
        ld      (CurPiecePtr),hl
        ld      a,(CurPieceIndex)
        ld      e,a
        ld      d,0
        ld      hl,PieceColorTbl
        add     hl,de
        ld      a,(hl)
        ld      (CurColorBits),a
        ret

; Shift a piece-row bitmask A right by ShiftCount positions (MSB-left:
; SRL moves the piece toward higher-numbered columns).
;! in A; out A; clobbers F
@ShiftRowMask:
        ld      c,a
        ld      a,(ShiftCount)
        or      a
        jr      z,_done
_loop:
        srl     c
        dec     a
        jr      nz,_loop
_done:
        ld      a,c
        ret

; Test a candidate placement at D=x, E=y against bounds and the board.
; Carry set means blocked. BC, DE, HL preserved.
;! in DE; out carry,zero; clobbers sign,parity,halfCarry
@CheckCollAt:
        push    bc
        push    de
        push    hl
        ld      a,(CurPieceRight)
        add     a,d
        cp      8
        jr      nc,_bound            ; x + right past the last column
        ld      a,d
        ld      (ShiftCount),a
        ld      l,e                  ; L = board row for piece row 0
        ld      b,4
        ld      de,(CurPiecePtr)
_row:
        ld      a,(de)
        ; expects out A
        call    ShiftRowMask
        ld      c,a
        or      a
        jr      z,_next              ; empty piece row
        ld      a,l
        cp      8
        jr      nc,_bound            ; occupied row below the floor
        push    de
        push    hl
        ld      h,0
        ld      de,BoardRows
        add     hl,de
        ld      a,(hl)
        pop     hl
        pop     de
        and     c
        jr      nz,_bound            ; overlaps settled cells
_next:
        inc     de
        inc     l
        djnz    _row
        or      a                    ; carry clear: placement legal
        jr      _exit
_bound:
        scf
_exit:
        pop     hl
        pop     de
        pop     bc
        ret

; OR mask C into row L of the plane at DE.
;! in C,DE,L; clobbers F
@OrPlaneRow:
        push    hl
        ld      h,0
        add     hl,de
        ld      a,(hl)
        or      c
        ld      (hl),a
        pop     hl
        ret

; Blit the active piece into the four board planes at PlayerX/PlayerY.
;! clobbers A,BC,DE,HL,F
@LockPiece:
        ld      a,(PlayerX)
        ld      (ShiftCount),a
        ld      a,(PlayerY)
        ld      l,a                  ; L = board row (H unused)
        ld      b,4
        ld      de,(CurPiecePtr)
_row:
        ld      a,(de)
        call    ShiftRowMask
        or      a
        jr      z,_next
        ld      c,a                  ; C = shifted mask
        ld      a,l
        cp      8
        jr      nc,_next
        push    de
        ld      de,BoardRows
        call    OrPlaneRow
        ld      a,(CurColorBits)
        and     COLOR_RED
        jr      z,_notred
        ld      de,BoardRed
        call    OrPlaneRow
_notred:
        ld      a,(CurColorBits)
        and     COLOR_GREEN
        jr      z,_notgreen
        ld      de,BoardGreen
        call    OrPlaneRow
_notgreen:
        ld      a,(CurColorBits)
        and     COLOR_BLUE
        jr      z,_notblue
        ld      de,BoardBlue
        call    OrPlaneRow
_notblue:
        pop     de
_next:
        inc     de
        inc     l
        djnz    _row
        ret

; Collapse row E: every plane shifts rows 0..E-1 down one; row 0
; clears. Preserves DE.
;! in E; clobbers F
@CollapseRow:
        push    de
        ld      b,4                  ; four planes
        ld      hl,BoardPlaneTbl
_plane:
        push    bc
        ld      c,(hl)
        inc     hl
        ld      b,(hl)
        inc     hl
        push    hl                   ; table cursor
        ld      h,b
        ld      l,c                  ; HL = plane base
        ld      d,0
        add     hl,de                ; HL = plane + row E
        ld      a,e
        or      a
        jr      z,_top               ; row 0: nothing above to copy
        ld      b,e
_shift:
        dec     hl
        ld      a,(hl)               ; row above
        inc     hl
        ld      (hl),a
        dec     hl
        djnz    _shift
_top:
        ld      (hl),0               ; the vacated top row
        pop     hl
        pop     bc
        djnz    _plane
        pop     de
        ret

; Clear every full row, collapsing the planes down. Out: A = rows
; cleared (0..4).
;! out A,E,carry; clobbers zero,sign,parity,halfCarry
@ClearFullRows:
        ld      c,0                  ; cleared count
        ld      e,7                  ; scan from the bottom row up
_scan:
        ld      hl,BoardRows
        ld      a,l
        add     a,e
        ld      l,a
        ld      a,h
        adc     a,0
        ld      h,a
        ld      a,(hl)
        inc     a                    ; $FF -> 0
        jr      nz,_up
        push    bc
        call    CollapseRow          ; row E collapses; re-test same E
        pop     bc
        inc     c
        jr      _scan
_up:
        ld      a,e
        or      a
        jr      z,_done
        dec     e
        jr      _scan
_done:
        ld      a,c
        ret

; Score delta for A cleared rows (clamped to 4). Out DE = delta.
;! in A; out DE; clobbers F
@ScoreForClears:
        cp      5
        jr      c,_ok
        ld      a,4
_ok:
        add     a,a
        ld      e,a
        ld      d,0
        ld      hl,ClearScoreTbl
        add     hl,de
        ld      e,(hl)
        inc     hl
        ld      d,(hl)
        ret

; Promote the next piece and roll a new preview; position at the
; spawn point. Out: carry set when the spawn placement is blocked
; (game over).
;! out carry,zero; clobbers sign,parity,halfCarry
@SpawnPiece:
        ld      a,(NextPieceIndex)
        ld      (CurPieceIndex),a
        ld      c,ApiRandom
        rst     $10                  ; A = random byte (destroys B)
        and     %00000111
        cp      7
        jr      nz,_have
        xor     a
_have:
        ld      (NextPieceIndex),a
        xor     a
        ld      (CurRotation),a
        ld      a,2
        ld      (PlayerX),a
        xor     a
        ld      (PlayerY),a
        call    SetCurPiece
        ld      d,2                  ; probe the spawn placement
        ld      e,0
        call    CheckCollAt
        ret

; Zero the 8 bytes at HL.
;! in HL; clobbers F
@ZeroPlane:
        ld      b,8
        xor     a
_loop:
        ld      (hl),a
        inc     hl
        djnz    _loop
        ret

; Reset the game state for a new round.
;! out carry,zero; clobbers sign,parity,halfCarry
@InitGame:
        ld      hl,BoardRows
        call    ZeroPlane
        ld      hl,BoardRed
        call    ZeroPlane
        ld      hl,BoardGreen
        call    ZeroPlane
        ld      hl,BoardBlue
        call    ZeroPlane
        ld      hl,0
        ld      (Score),hl
        xor     a
        ld      (LinesCleared),a
        ret

; Rebuild the framebuffer from the board planes, then overlay the
; active piece in its colour. Row-major: each matrix row is R,G,B,aux
; bytes at Framebuffer + row*4, MSB-left like the planes.
;! out A,zero; clobbers carry,sign,parity,halfCarry
@DrawBoardFb:
        ld      a,(PlayerX)
        ld      (ShiftCount),a
        ld      b,0                  ; B = row 0..7
_row:
        ld      a,b
        add     a,a
        add     a,a                  ; row*4
        ld      e,a
        ld      d,0
        ld      hl,Framebuffer
        add     hl,de
        ex      de,hl                ; DE = this row's R byte
        ; C = active piece mask for this row (0 outside the piece box)
        ld      a,(PlayerY)
        ld      c,a
        ld      a,b
        sub     c
        ld      c,0
        cp      4
        jr      nc,_planes           ; row outside piece rows 0..3
        push    de
        ld      hl,(CurPiecePtr)
        ld      e,a
        ld      d,0
        add     hl,de
        ld      a,(hl)
        pop     de
        ; expects out A
        call    ShiftRowMask
        ld      c,a
_planes:
        ; red
        ld      hl,BoardRed
        ld      a,l
        add     a,b
        ld      l,a
        ld      a,h
        adc     a,0
        ld      h,a
        ld      a,(CurColorBits)
        and     COLOR_RED            ; Z survives the plane load below
        ld      a,(hl)
        jr      z,_red
        or      c
_red:
        ld      (de),a
        inc     de
        ; green
        ld      hl,BoardGreen
        ld      a,l
        add     a,b
        ld      l,a
        ld      a,h
        adc     a,0
        ld      h,a
        ld      a,(CurColorBits)
        and     COLOR_GREEN
        ld      a,(hl)
        jr      z,_green
        or      c
_green:
        ld      (de),a
        inc     de
        ; blue
        ld      hl,BoardBlue
        ld      a,l
        add     a,b
        ld      l,a
        ld      a,h
        adc     a,0
        ld      h,a
        ld      a,(CurColorBits)
        and     COLOR_BLUE
        ld      a,(hl)
        jr      z,_blue
        or      c
_blue:
        ld      (de),a
        inc     b
        ld      a,b
        cp      8
        jr      c,_row
        ret
