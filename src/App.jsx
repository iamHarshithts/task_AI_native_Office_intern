import { useState, useRef, useCallback, useMemo, useEffect } from 'react'
import './App.css'
import { createEngine } from './engine/core.js'

const TOTAL_ROWS = 50
const TOTAL_COLS = 50

// ─────────────────────────────────────────────────────────────
//  Sort / Filter helpers (view-layer only — engine untouched)
// ─────────────────────────────────────────────────────────────

/** Compare two cell display values for sorting */
function compareValues(a, b) {
  const aNum = parseFloat(a)
  const bNum = parseFloat(b)
  const aIsNum = !isNaN(aNum) && a !== ''
  const bIsNum = !isNaN(bNum) && b !== ''

  if (aIsNum && bIsNum) return aNum - bNum
  if (aIsNum) return -1   // numbers before strings
  if (bIsNum) return 1
  return String(a).localeCompare(String(b))
}

/** Cycle sort direction: none → asc → desc → none */
function nextSortDir(current) {
  if (current === 'none') return 'asc'
  if (current === 'asc') return 'desc'
  return 'none'
}

// ─────────────────────────────────────────────────────────────
//  FilterDropdown component
// ─────────────────────────────────────────────────────────────

function FilterDropdown({ colIndex, engine, viewRows, activeFilters, onApply, onClose }) {
  // Collect unique display values from current viewRows for this column
  const uniqueValues = useMemo(() => {
    const seen = new Set()
    const vals = []
    for (const rowIndex of viewRows) {
      const cellData = engine.getCell(rowIndex, colIndex)
      const display = cellData.error
        ? cellData.error
        : (cellData.computed !== null && cellData.computed !== '' ? String(cellData.computed) : cellData.raw)
      if (!seen.has(display)) {
        seen.add(display)
        vals.push(display)
      }
    }
    return vals.sort((a, b) => compareValues(a, b))
  }, [viewRows, colIndex, engine])

  const existing = activeFilters[colIndex] || new Set(uniqueValues)
  const [checked, setChecked] = useState(() => new Set(existing))
  const allChecked = checked.size === uniqueValues.length

  const toggle = (val) => {
    setChecked(prev => {
      const next = new Set(prev)
      next.has(val) ? next.delete(val) : next.add(val)
      return next
    })
  }

  const toggleAll = () => {
    setChecked(allChecked ? new Set() : new Set(uniqueValues))
  }

  return (
    <div className="filter-dropdown" onClick={e => e.stopPropagation()}>
      <div className="filter-header">
        <span className="filter-title">Filter</span>
        <button className="filter-close-btn" onClick={onClose}>✕</button>
      </div>
      <div className="filter-search-row">
        <label className="filter-check-row">
          <input type="checkbox" checked={allChecked} onChange={toggleAll} />
          <span>(Select All)</span>
        </label>
      </div>
      <div className="filter-list">
        {uniqueValues.map(val => (
          <label key={val} className="filter-check-row">
            <input
              type="checkbox"
              checked={checked.has(val)}
              onChange={() => toggle(val)}
            />
            <span className="filter-val-label">{val === '' ? '(Blank)' : val}</span>
          </label>
        ))}
      </div>
      <div className="filter-actions">
        <button className="filter-btn-cancel" onClick={onClose}>Cancel</button>
        <button
          className="filter-btn-apply"
          onClick={() => onApply(colIndex, checked.size === uniqueValues.length ? null : checked)}
        >
          OK
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
//  Main App
// ─────────────────────────────────────────────────────────────

export default function App() {
  const [engine] = useState(() => createEngine(TOTAL_ROWS, TOTAL_COLS))
  const [version, setVersion] = useState(0)
  const [selectedCell, setSelectedCell] = useState(null)
  const [editingCell, setEditingCell] = useState(null)
  const [editValue, setEditValue] = useState('')
  const [cellStyles, setCellStyles] = useState({})
  const cellInputRef = useRef(null)

  // ── Sort state: { col: number, dir: 'asc'|'desc'|'none' }
  const [sortState, setSortState] = useState({ col: -1, dir: 'none' })

  // ── Filter state: { [colIndex]: Set<string> | null }
  //    null means "no filter active" (show all); a Set means show only those values
  const [activeFilters, setActiveFilters] = useState({})

  // ── Which column's filter dropdown is open
  const [openFilterCol, setOpenFilterCol] = useState(null)

  const filterDropdownRef = useRef(null)

  const forceRerender = useCallback(() => setVersion(v => v + 1), [])

  // Close filter dropdown on outside click
  useEffect(() => {
    if (openFilterCol === null) return
    const handler = (e) => {
      if (filterDropdownRef.current && !filterDropdownRef.current.contains(e.target)) {
        setOpenFilterCol(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [openFilterCol])

  // ── View-layer row computation ──────────────────────────────
  //
  //  1. Start with ALL physical row indices
  //  2. Apply filters (hide rows where the filtered col's value isn't in the allowed set)
  //  3. Apply sort (reorder by the sort column's computed value)
  //
  //  The underlying engine rows are NEVER modified. Formulas keep referencing
  //  their original physical row indices (A1 = row 0, etc.).

  const viewRows = useMemo(() => {
    // Step 1: all rows
    let rows = Array.from({ length: engine.rows }, (_, i) => i)

    // Step 2: apply filters
    for (const [colStr, allowedSet] of Object.entries(activeFilters)) {
      if (!allowedSet) continue
      const col = parseInt(colStr)
      rows = rows.filter(rowIndex => {
        const cellData = engine.getCell(rowIndex, col)
        const display = cellData.error
          ? cellData.error
          : (cellData.computed !== null && cellData.computed !== '' ? String(cellData.computed) : cellData.raw)
        return allowedSet.has(display)
      })
    }

    // Step 3: apply sort
    if (sortState.col >= 0 && sortState.dir !== 'none') {
      const col = sortState.col
      const dir = sortState.dir
      rows = [...rows].sort((a, b) => {
        const aData = engine.getCell(a, col)
        const bData = engine.getCell(b, col)
        const aVal = aData.error ? aData.error : (aData.computed !== null && aData.computed !== '' ? String(aData.computed) : aData.raw)
        const bVal = bData.error ? bData.error : (bData.computed !== null && bData.computed !== '' ? String(bData.computed) : bData.raw)
        const cmp = compareValues(aVal, bVal)
        return dir === 'asc' ? cmp : -cmp
      })
    }

    return rows
  }, [engine, version, sortState, activeFilters])

  // ── Sort click ──

  const handleSortClick = useCallback((colIndex) => {
    setSortState(prev => {
      if (prev.col === colIndex) {
        return { col: colIndex, dir: nextSortDir(prev.dir) }
      }
      return { col: colIndex, dir: 'asc' }
    })
  }, [])

  // ── Filter apply ──

  const handleFilterApply = useCallback((colIndex, allowedSet) => {
    setActiveFilters(prev => {
      const next = { ...prev }
      if (allowedSet === null) {
        delete next[colIndex]
      } else {
        next[colIndex] = allowedSet
      }
      return next
    })
    setOpenFilterCol(null)
  }, [])

  const clearAllFilters = useCallback(() => {
    setActiveFilters({})
    setSortState({ col: -1, dir: 'none' })
  }, [])

  const hasAnyFilterOrSort = Object.keys(activeFilters).some(k => activeFilters[k] !== null) || sortState.dir !== 'none'

  // ────── Cell style helpers ──────

  const getCellStyle = useCallback((row, col) => {
    const key = `${row},${col}`
    return cellStyles[key] || {
      bold: false, italic: false, underline: false,
      bg: 'white', color: '#202124', align: 'left', fontSize: 13
    }
  }, [cellStyles])

  const updateCellStyle = useCallback((row, col, updates) => {
    const key = `${row},${col}`
    setCellStyles(prev => ({
      ...prev,
      [key]: { ...getCellStyle(row, col), ...updates }
    }))
  }, [getCellStyle])

  // ────── Cell editing ──────

  const startEditing = useCallback((row, col) => {
    setSelectedCell({ r: row, c: col })
    setEditingCell({ r: row, c: col })
    const cellData = engine.getCell(row, col)
    setEditValue(cellData.raw)
    setTimeout(() => cellInputRef.current?.focus(), 0)
  }, [engine])

  const commitEdit = useCallback((row, col) => {
    const currentCell = engine.getCell(row, col)
    if (currentCell.raw !== editValue) {
      engine.setCell(row, col, editValue)
      forceRerender()
    }
    setEditingCell(null)
  }, [engine, editValue, forceRerender])

  const handleCellClick = useCallback((row, col) => {
    if (editingCell && (editingCell.r !== row || editingCell.c !== col)) {
      commitEdit(editingCell.r, editingCell.c)
    }
    if (!editingCell || editingCell.r !== row || editingCell.c !== col) {
      startEditing(row, col)
    }
  }, [editingCell, commitEdit, startEditing])

  // ────── Keyboard navigation ──────

  const handleKeyDown = useCallback((event, row, col) => {
    // Navigate in view space (sorted/filtered row order)
    const viewIndex = viewRows.indexOf(row)
    if (event.key === 'Enter') {
      event.preventDefault()
      commitEdit(row, col)
      const nextViewRow = viewRows[Math.min(viewIndex + 1, viewRows.length - 1)]
      startEditing(nextViewRow, col)
    } else if (event.key === 'Tab') {
      event.preventDefault()
      commitEdit(row, col)
      startEditing(row, Math.min(col + 1, engine.cols - 1))
    } else if (event.key === 'Escape') {
      setEditValue(engine.getCell(row, col).raw)
      setEditingCell(null)
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      commitEdit(row, col)
      const nextViewRow = viewRows[Math.min(viewIndex + 1, viewRows.length - 1)]
      startEditing(nextViewRow, col)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      commitEdit(row, col)
      const prevViewRow = viewRows[Math.max(viewIndex - 1, 0)]
      startEditing(prevViewRow, col)
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      commitEdit(row, col)
      if (col > 0) {
        startEditing(row, col - 1)
      } else if (viewIndex > 0) {
        startEditing(viewRows[viewIndex - 1], engine.cols - 1)
      }
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      commitEdit(row, col)
      startEditing(row, Math.min(col + 1, engine.cols - 1))
    }
  }, [engine, commitEdit, startEditing, viewRows])

  // ────── Formula bar handlers ──────

  const handleFormulaBarKeyDown = useCallback((event) => {
    if (!editingCell) return
    handleKeyDown(event, editingCell.r, editingCell.c)
  }, [editingCell, handleKeyDown])

  const handleFormulaBarFocus = useCallback(() => {
    if (selectedCell && !editingCell) {
      setEditingCell(selectedCell)
      setEditValue(engine.getCell(selectedCell.r, selectedCell.c).raw)
    }
  }, [selectedCell, editingCell, engine])

  const handleFormulaBarChange = useCallback((value) => {
    if (!editingCell && selectedCell) setEditingCell(selectedCell)
    setEditValue(value)
  }, [editingCell, selectedCell])

  // ────── Undo / Redo ──────

  const handleUndo = useCallback(() => { if (engine.undo()) forceRerender() }, [engine, forceRerender])
  const handleRedo = useCallback(() => { if (engine.redo()) forceRerender() }, [engine, forceRerender])

  // ────── Formatting toggles ──────

  const toggleBold = useCallback(() => {
    if (!selectedCell) return
    const style = getCellStyle(selectedCell.r, selectedCell.c)
    updateCellStyle(selectedCell.r, selectedCell.c, { bold: !style.bold })
  }, [selectedCell, getCellStyle, updateCellStyle])

  const toggleItalic = useCallback(() => {
    if (!selectedCell) return
    const style = getCellStyle(selectedCell.r, selectedCell.c)
    updateCellStyle(selectedCell.r, selectedCell.c, { italic: !style.italic })
  }, [selectedCell, getCellStyle, updateCellStyle])

  const toggleUnderline = useCallback(() => {
    if (!selectedCell) return
    const style = getCellStyle(selectedCell.r, selectedCell.c)
    updateCellStyle(selectedCell.r, selectedCell.c, { underline: !style.underline })
  }, [selectedCell, getCellStyle, updateCellStyle])

  const changeFontSize = useCallback((size) => {
    if (!selectedCell) return
    updateCellStyle(selectedCell.r, selectedCell.c, { fontSize: size })
  }, [selectedCell, updateCellStyle])

  const changeAlignment = useCallback((align) => {
    if (!selectedCell) return
    updateCellStyle(selectedCell.r, selectedCell.c, { align })
  }, [selectedCell, updateCellStyle])

  const changeFontColor = useCallback((color) => {
    if (!selectedCell) return
    updateCellStyle(selectedCell.r, selectedCell.c, { color })
  }, [selectedCell, updateCellStyle])

  const changeBackgroundColor = useCallback((color) => {
    if (!selectedCell) return
    updateCellStyle(selectedCell.r, selectedCell.c, { bg: color })
  }, [selectedCell, updateCellStyle])

  // ────── Clear operations ──────

  const clearSelectedCell = useCallback(() => {
    if (!selectedCell) return
    engine.setCell(selectedCell.r, selectedCell.c, '')
    forceRerender()
    const key = `${selectedCell.r},${selectedCell.c}`
    setCellStyles(prev => { const next = { ...prev }; delete next[key]; return next })
    setEditValue('')
  }, [selectedCell, engine, forceRerender])

  const clearAllCells = useCallback(() => {
    for (let r = 0; r < engine.rows; r++) {
      for (let c = 0; c < engine.cols; c++) {
        engine.setCell(r, c, '')
      }
    }
    forceRerender()
    setCellStyles({})
    setSelectedCell(null)
    setEditingCell(null)
    setEditValue('')
    clearAllFilters()
  }, [engine, forceRerender, clearAllFilters])

  // ────── Row / Column operations ──────

  const insertRow = useCallback(() => {
    if (!selectedCell) return
    engine.insertRow(selectedCell.r)
    forceRerender()
    setSelectedCell({ r: selectedCell.r + 1, c: selectedCell.c })
  }, [selectedCell, engine, forceRerender])

  const deleteRow = useCallback(() => {
    if (!selectedCell) return
    engine.deleteRow(selectedCell.r)
    forceRerender()
    if (selectedCell.r >= engine.rows) {
      setSelectedCell({ r: engine.rows - 1, c: selectedCell.c })
    }
  }, [selectedCell, engine, forceRerender])

  const insertColumn = useCallback(() => {
    if (!selectedCell) return
    engine.insertColumn(selectedCell.c)
    forceRerender()
    setSelectedCell({ r: selectedCell.r, c: selectedCell.c + 1 })
  }, [selectedCell, engine, forceRerender])

  const deleteColumn = useCallback(() => {
    if (!selectedCell) return
    engine.deleteColumn(selectedCell.c)
    forceRerender()
    if (selectedCell.c >= engine.cols) {
      setSelectedCell({ r: selectedCell.r, c: engine.cols - 1 })
    }
  }, [selectedCell, engine, forceRerender])

  // ────── Derived state ──────

  const selectedCellStyle = useMemo(() => {
    return selectedCell ? getCellStyle(selectedCell.r, selectedCell.c) : null
  }, [selectedCell, getCellStyle])

  const getColumnLabel = useCallback((col) => {
    let label = ''
    let num = col + 1
    while (num > 0) {
      num--
      label = String.fromCharCode(65 + (num % 26)) + label
      num = Math.floor(num / 26)
    }
    return label
  }, [])

  const selectedCellLabel = selectedCell
    ? `${getColumnLabel(selectedCell.c)}${selectedCell.r + 1}`
    : 'No cell'

  const formulaBarValue = editingCell
    ? editValue
    : (selectedCell ? engine.getCell(selectedCell.r, selectedCell.c).raw : '')

  // Hidden row count indicator
  const hiddenRowCount = engine.rows - viewRows.length

  // ────── Render ──────

  return (
    <div className="app-wrapper">
      <div className="app-header">
        <h2 className="app-title">📊 Spreadsheet App</h2>
      </div>

      <div className="main-content">

        {/* ── Toolbar ── */}
        <div className="toolbar">
          <div className="toolbar-group">
            <button className={`toolbar-btn bold-btn ${selectedCellStyle?.bold ? 'active' : ''}`} onClick={toggleBold} title="Bold">B</button>
            <button className={`toolbar-btn italic-btn ${selectedCellStyle?.italic ? 'active' : ''}`} onClick={toggleItalic} title="Italic">I</button>
            <button className={`toolbar-btn underline-btn ${selectedCellStyle?.underline ? 'active' : ''}`} onClick={toggleUnderline} title="Underline">U</button>
          </div>

          <div className="toolbar-group">
            <span className="toolbar-label">Size:</span>
            <select className="toolbar-select" value={selectedCellStyle?.fontSize || 13} onChange={(e) => changeFontSize(parseInt(e.target.value))}>
              {[8, 10, 11, 12, 13, 14, 16, 18, 20, 24].map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div className="toolbar-group">
            <button className={`align-btn ${selectedCellStyle?.align === 'left' ? 'active' : ''}`} onClick={() => changeAlignment('left')} title="Align Left">⬤←</button>
            <button className={`align-btn ${selectedCellStyle?.align === 'center' ? 'active' : ''}`} onClick={() => changeAlignment('center')} title="Align Center">⬤</button>
            <button className={`align-btn ${selectedCellStyle?.align === 'right' ? 'active' : ''}`} onClick={() => changeAlignment('right')} title="Align Right">⬤→</button>
          </div>

          <div className="toolbar-group">
            <span className="toolbar-label">Text:</span>
            <input
              type="color"
              value={selectedCellStyle?.color || '#000000'}
              onChange={(e) => changeFontColor(e.target.value)}
              title="Font color"
              style={{ width: '32px', height: '32px', border: '1px solid #dadce0', cursor: 'pointer', borderRadius: '4px' }}
            />
          </div>

          <div className="toolbar-group">
            <span className="toolbar-label">Fill:</span>
            <select className="toolbar-select" value={selectedCellStyle?.bg || 'white'} onChange={(e) => changeBackgroundColor(e.target.value)}>
              <option value="white">White</option>
              <option value="#ffff99">Yellow</option>
              <option value="#99ffcc">Green</option>
              <option value="#ffcccc">Red</option>
              <option value="#cce5ff">Blue</option>
              <option value="#e0ccff">Purple</option>
              <option value="#ffd9b3">Orange</option>
              <option value="#f0f0f0">Gray</option>
            </select>
          </div>

          <div className="toolbar-group">
            <button className="toolbar-btn" onClick={handleUndo} disabled={!engine.canUndo()} title="Undo">↶ Undo</button>
            <button className="toolbar-btn" onClick={handleRedo} disabled={!engine.canRedo()} title="Redo">↷ Redo</button>
          </div>

          <div className="toolbar-group">
            <button className="toolbar-btn" onClick={insertRow} title="Insert Row">+ Row</button>
            <button className="toolbar-btn" onClick={deleteRow} title="Delete Row">- Row</button>
            <button className="toolbar-btn" onClick={insertColumn} title="Insert Column">+ Col</button>
            <button className="toolbar-btn" onClick={deleteColumn} title="Delete Column">- Col</button>
          </div>

          <div className="toolbar-group">
            <button className="toolbar-btn danger" onClick={clearSelectedCell}>✕ Cell</button>
            <button className="toolbar-btn danger" onClick={clearAllCells}>✕ All</button>
          </div>

          {/* ── Sort/Filter clear ── */}
          {hasAnyFilterOrSort && (
            <div className="toolbar-group">
              <button className="toolbar-btn filter-clear-btn" onClick={clearAllFilters} title="Clear all sorts and filters">
                ⊘ Clear Sort/Filter
                {hiddenRowCount > 0 && <span className="hidden-badge">{hiddenRowCount} hidden</span>}
              </button>
            </div>
          )}
        </div>

        {/* ── Status bar: filtered row info ── */}
        {hiddenRowCount > 0 && (
          <div className="filter-status-bar">
            <span className="filter-status-icon">🔍</span>
            Showing <strong>{viewRows.length}</strong> of <strong>{engine.rows}</strong> rows
            &nbsp;·&nbsp; {hiddenRowCount} row{hiddenRowCount !== 1 ? 's' : ''} hidden by filter
            <button className="filter-status-clear" onClick={clearAllFilters}>Clear filters</button>
          </div>
        )}

        {/* ── Formula Bar ── */}
        <div className="formula-bar">
          <span className="formula-bar-label">{selectedCellLabel}</span>
          <input
            className="formula-bar-input"
            value={formulaBarValue}
            onChange={(e) => handleFormulaBarChange(e.target.value)}
            onKeyDown={handleFormulaBarKeyDown}
            onFocus={handleFormulaBarFocus}
            placeholder="Select a cell then type, or enter a formula like =SUM(A1:A5)"
          />
        </div>

        {/* ── Grid ── */}
        <div className="grid-scroll">
          <table className="grid-table">
            <thead>
              <tr>
                <th className="col-header-blank"></th>
                {Array.from({ length: engine.cols }, (_, colIndex) => {
                  const isSorted = sortState.col === colIndex && sortState.dir !== 'none'
                  const isFiltered = !!activeFilters[colIndex]
                  const isDropdownOpen = openFilterCol === colIndex

                  return (
                    <th
                      key={colIndex}
                      className={`col-header ${isSorted ? 'col-header-sorted' : ''} ${isFiltered ? 'col-header-filtered' : ''}`}
                    >
                      <div className="col-header-inner">
                        {/* Column letter — click to sort */}
                        <button
                          className="col-sort-btn"
                          onClick={() => handleSortClick(colIndex)}
                          title={`Sort by column ${getColumnLabel(colIndex)}`}
                        >
                          <span className="col-label">{getColumnLabel(colIndex)}</span>
                          <span className="sort-indicator">
                            {isSorted
                              ? (sortState.dir === 'asc' ? '↑' : '↓')
                              : <span className="sort-indicator-idle">⇅</span>}
                          </span>
                        </button>

                        {/* Filter funnel button */}
                        <div className="filter-btn-wrap" ref={isDropdownOpen ? filterDropdownRef : null}>
                          <button
                            className={`col-filter-btn ${isFiltered ? 'col-filter-btn-active' : ''} ${isDropdownOpen ? 'col-filter-btn-open' : ''}`}
                            onClick={(e) => {
                              e.stopPropagation()
                              setOpenFilterCol(isDropdownOpen ? null : colIndex)
                            }}
                            title={`Filter column ${getColumnLabel(colIndex)}`}
                          >
                            {isFiltered ? '🔽' : '▽'}
                          </button>

                          {isDropdownOpen && (
                            <FilterDropdown
                              colIndex={colIndex}
                              engine={engine}
                              viewRows={Array.from({ length: engine.rows }, (_, i) => i)} // always show all values in dropdown
                              activeFilters={activeFilters}
                              onApply={handleFilterApply}
                              onClose={() => setOpenFilterCol(null)}
                            />
                          )}
                        </div>
                      </div>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {viewRows.map((rowIndex) => (
                <tr key={rowIndex} className="grid-row">
                  {/* Row number shows original physical row index — makes formula references clear */}
                  <td className="row-header">{rowIndex + 1}</td>
                  {Array.from({ length: engine.cols }, (_, colIndex) => {
                    const isSelected = selectedCell?.r === rowIndex && selectedCell?.c === colIndex
                    const isEditing = editingCell?.r === rowIndex && editingCell?.c === colIndex
                    const cellData = engine.getCell(rowIndex, colIndex)
                    const style = cellStyles[`${rowIndex},${colIndex}`] || {}
                    const displayValue = cellData.error
                      ? cellData.error
                      : (cellData.computed !== null && cellData.computed !== '' ? String(cellData.computed) : cellData.raw)

                    return (
                      <td
                        key={colIndex}
                        className={`cell ${isSelected ? 'selected' : ''}`}
                        style={{ background: style.bg || 'white' }}
                        onMouseDown={(e) => { e.preventDefault(); handleCellClick(rowIndex, colIndex) }}
                      >
                        {isEditing ? (
                          <input
                            autoFocus
                            className="cell-input"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={() => commitEdit(rowIndex, colIndex)}
                            onKeyDown={(e) => handleKeyDown(e, rowIndex, colIndex)}
                            ref={isSelected ? cellInputRef : undefined}
                            style={{
                              fontWeight: style.bold ? 'bold' : 'normal',
                              fontStyle: style.italic ? 'italic' : 'normal',
                              textDecoration: style.underline ? 'underline' : 'none',
                              color: style.color || '#202124',
                              fontSize: (style.fontSize || 13) + 'px',
                              textAlign: style.align || 'left',
                              background: style.bg || 'white',
                            }}
                          />
                        ) : (
                          <div
                            className={`cell-display align-${style.align || 'left'} ${cellData.error ? 'error' : ''}`}
                            style={{
                              fontWeight: style.bold ? 'bold' : 'normal',
                              fontStyle: style.italic ? 'italic' : 'normal',
                              textDecoration: style.underline ? 'underline' : 'none',
                              color: cellData.error ? '#d93025' : (style.color || '#202124'),
                              fontSize: (style.fontSize || 13) + 'px',
                            }}
                          >
                            {displayValue}
                          </div>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="footer-hint">
          Click column letters to sort (↑ asc → ↓ desc → clear) · Click ▽ to filter · Formulas always reference original cell positions
        </p>
      </div>
    </div>
  )
}
