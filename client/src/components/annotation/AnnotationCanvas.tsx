import { useRef, useEffect, useState, useCallback, useLayoutEffect } from 'react'
import type { BoundingBox, ResizeHandle, Point, CanvasTransform } from './types'

const LEFT_COLOR = '#3b82f6'
const RIGHT_COLOR = '#f97316'
const SELECTED_COLOR = '#ffffff'
const HANDLE_SIZE = 8
const MIN_BOX_SIZE = 0.02
const ROTATION_HANDLE_DIST = 24
const ROTATION_HANDLE_RADIUS = 5

interface ZoomControl {
  zoomIn: () => void
  zoomOut: () => void
  zoomReset: () => void
}

interface Props {
  imageUrl: string
  boxes: BoundingBox[]
  onBoxesChange: (boxes: BoundingBox[]) => void
  selectedId: string | null
  onSelectedChange: (id: string | null) => void
  readOnly?: boolean
  onZoomChange?: (zoom: number) => void
  zoomRef?: React.MutableRefObject<ZoomControl | null>
}

type Mode = 'idle' | 'drawing' | 'moving' | 'resizing' | 'panning' | 'rotating'

export function AnnotationCanvas({
  imageUrl,
  boxes,
  onBoxesChange,
  selectedId,
  onSelectedChange,
  readOnly = false,
  onZoomChange,
  zoomRef,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const [imageLoaded, setImageLoaded] = useState(false)
  const [transform, setTransform] = useState<CanvasTransform>({ zoom: 1, offsetX: 0, offsetY: 0 })
  const [mode, setMode] = useState<Mode>('idle')
  const [drawStart, setDrawStart] = useState<Point | null>(null)
  const [drawCurrent, setDrawCurrent] = useState<Point | null>(null)
  const [activeHandle, setActiveHandle] = useState<ResizeHandle | null>(null)
  const [dragStart, setDragStart] = useState<Point | null>(null)
  const [originalBox, setOriginalBox] = useState<BoundingBox | null>(null)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const [panStart, setPanStart] = useState<Point | null>(null)
  const [hoverHandle, setHoverHandle] = useState<ResizeHandle | null>(null)
  const [hoverBox, setHoverBox] = useState<string | null>(null)
  const [hoverRotate, setHoverRotate] = useState(false)
  const [rotateStartAngle, setRotateStartAngle] = useState<number | null>(null)

  const fitToContainer = useCallback(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    const img = imageRef.current
    if (!canvas || !container || !img) return

    const containerW = container.clientWidth
    const containerH = container.clientHeight
    if (containerW <= 0 || containerH <= 0) return

    const scale = Math.min(containerW / img.width, containerH / img.height, 1)

    setTransform({
      zoom: scale,
      offsetX: (containerW - img.width * scale) / 2,
      offsetY: (containerH - img.height * scale) / 2,
    })
  }, [])

  const zoomIn = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const mx = rect.width / 2
    const my = rect.height / 2
    setTransform(t => {
      const nz = Math.max(0.5, Math.min(4, t.zoom * 1.2))
      const wx = (mx - t.offsetX) / t.zoom
      const wy = (my - t.offsetY) / t.zoom
      return { zoom: nz, offsetX: mx - wx * nz, offsetY: my - wy * nz }
    })
  }, [])

  const zoomOut = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const mx = rect.width / 2
    const my = rect.height / 2
    setTransform(t => {
      const nz = Math.max(0.5, Math.min(4, t.zoom / 1.2))
      const wx = (mx - t.offsetX) / t.zoom
      const wy = (my - t.offsetY) / t.zoom
      return { zoom: nz, offsetX: mx - wx * nz, offsetY: my - wy * nz }
    })
  }, [])

  const zoomReset = useCallback(() => {
    fitToContainer()
  }, [fitToContainer])

  useLayoutEffect(() => {
    if (!zoomRef) return
    zoomRef.current = { zoomIn, zoomOut, zoomReset }
    return () => { zoomRef.current = null }
  }, [zoomRef, zoomIn, zoomOut, zoomReset])

  useEffect(() => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      imageRef.current = img
      setImageLoaded(true)
      fitToContainer()
    }
    img.src = imageUrl
  }, [imageUrl, fitToContainer])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const ro = new ResizeObserver(() => fitToContainer())
    ro.observe(container)
    return () => ro.disconnect()
  })

  useEffect(() => {
    window.addEventListener('resize', fitToContainer)
    return () => window.removeEventListener('resize', fitToContainer)
  }, [fitToContainer])

  useEffect(() => {
    onZoomChange?.(transform.zoom)
  }, [transform.zoom, onZoomChange])

  const toImageCoords = useCallback((clientX: number, clientY: number): Point => {
    const canvas = canvasRef.current
    const img = imageRef.current
    if (!canvas || !img) return { x: 0, y: 0 }

    const rect = canvas.getBoundingClientRect()
    const canvasX = clientX - rect.left
    const canvasY = clientY - rect.top

    const imgX = (canvasX - transform.offsetX) / transform.zoom / img.width
    const imgY = (canvasY - transform.offsetY) / transform.zoom / img.height

    return { x: imgX, y: imgY }
  }, [transform])

  const getHandleAtPoint = useCallback((imgPoint: Point, box: BoundingBox): ResizeHandle | null => {
    const img = imageRef.current
    if (!img) return null

    const handleSizeNorm = HANDLE_SIZE / (img.width * transform.zoom)
    const handles: { handle: ResizeHandle; x: number; y: number }[] = [
      { handle: 'nw', x: box.x, y: box.y },
      { handle: 'n', x: box.x + box.width / 2, y: box.y },
      { handle: 'ne', x: box.x + box.width, y: box.y },
      { handle: 'w', x: box.x, y: box.y + box.height / 2 },
      { handle: 'e', x: box.x + box.width, y: box.y + box.height / 2 },
      { handle: 'sw', x: box.x, y: box.y + box.height },
      { handle: 's', x: box.x + box.width / 2, y: box.y + box.height },
      { handle: 'se', x: box.x + box.width, y: box.y + box.height },
    ]

    for (const h of handles) {
      if (Math.abs(imgPoint.x - h.x) < handleSizeNorm && Math.abs(imgPoint.y - h.y) < handleSizeNorm) {
        return h.handle
      }
    }
    return null
  }, [transform])

  const getRotateHandleAtPoint = useCallback((clientX: number, clientY: number, box: BoundingBox): boolean => {
    const canvas = canvasRef.current
    const img = imageRef.current
    if (!canvas || !img) return false

    const rect = canvas.getBoundingClientRect()
    const imgW = img.width

    const cx = ((box.x + box.width / 2) * imgW * transform.zoom) + transform.offsetX
    const cy = (box.y * img.height * transform.zoom) + transform.offsetY

    const rhX = cx
    const rhY = cy - ROTATION_HANDLE_DIST

    const screenX = clientX - rect.left
    const screenY = clientY - rect.top

    const dist = Math.sqrt((screenX - rhX) ** 2 + (screenY - rhY) ** 2)
    return dist < ROTATION_HANDLE_RADIUS + 4
  }, [transform])

  const pointInBox = useCallback((imgPoint: Point, box: BoundingBox): boolean => {
    if (!box.rotation) {
      return (
        imgPoint.x >= box.x &&
        imgPoint.x <= box.x + box.width &&
        imgPoint.y >= box.y &&
        imgPoint.y <= box.y + box.height
      )
    }
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    const cos = Math.cos(-box.rotation)
    const sin = Math.sin(-box.rotation)
    const dx = imgPoint.x - cx
    const dy = imgPoint.y - cy
    const localX = dx * cos - dy * sin + cx
    const localY = dx * sin + dy * cos + cy
    return (
      localX >= box.x &&
      localX <= box.x + box.width &&
      localY >= box.y &&
      localY <= box.y + box.height
    )
  }, [])

  const render = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    const img = imageRef.current
    if (!canvas || !ctx || !img || !imageLoaded) return

    const container = containerRef.current
    if (container) {
      canvas.width = container.clientWidth
      canvas.height = container.clientHeight
    }

    ctx.fillStyle = '#0a0a0a'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    ctx.save()
    ctx.translate(transform.offsetX, transform.offsetY)
    ctx.scale(transform.zoom, transform.zoom)

    ctx.drawImage(img, 0, 0)

    for (const box of boxes) {
      const isSelected = box.id === selectedId
      const color = box.hand === 'left' ? LEFT_COLOR : RIGHT_COLOR

      const cw = box.width * img.width
      const ch = box.height * img.height
      const cx = (box.x + box.width / 2) * img.width
      const cy = (box.y + box.height / 2) * img.height

      ctx.save()
      ctx.translate(cx, cy)
      if (box.rotation) ctx.rotate(box.rotation)

      ctx.fillStyle = color + '33'
      ctx.fillRect(-cw / 2, -ch / 2, cw, ch)

      ctx.strokeStyle = isSelected ? SELECTED_COLOR : color
      ctx.lineWidth = isSelected ? 3 / transform.zoom : 2 / transform.zoom
      if (isSelected) ctx.setLineDash([5 / transform.zoom, 5 / transform.zoom])
      else ctx.setLineDash([])
      ctx.strokeRect(-cw / 2, -ch / 2, cw, ch)

      const labelSize = 16 / transform.zoom
      const labelPad = 4 / transform.zoom
      const labelX = -cw / 2 + labelPad
      const labelY = -ch / 2 + labelPad
      ctx.fillStyle = color
      ctx.fillRect(labelX, labelY, labelSize, labelSize)
      ctx.fillStyle = '#ffffff'
      ctx.font = `bold ${12 / transform.zoom}px Inter, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(box.hand === 'left' ? 'L' : 'R', labelX + labelSize / 2, labelY + labelSize / 2)

      ctx.setLineDash([])
      ctx.restore()

      if (isSelected && !readOnly) {
        const hs = HANDLE_SIZE / transform.zoom
        const handles = [
          { x: box.x, y: box.y },
          { x: box.x + box.width / 2, y: box.y },
          { x: box.x + box.width, y: box.y },
          { x: box.x, y: box.y + box.height / 2 },
          { x: box.x + box.width, y: box.y + box.height / 2 },
          { x: box.x, y: box.y + box.height },
          { x: box.x + box.width / 2, y: box.y + box.height },
          { x: box.x + box.width, y: box.y + box.height },
        ]
        for (const h of handles) {
          ctx.fillStyle = '#ffffff'
          ctx.strokeStyle = '#000000'
          ctx.lineWidth = 1 / transform.zoom
          ctx.setLineDash([])
          ctx.fillRect(h.x * img.width - hs / 2, h.y * img.height - hs / 2, hs, hs)
          ctx.strokeRect(h.x * img.width - hs / 2, h.y * img.height - hs / 2, hs, hs)
        }

        const rhX = (box.x + box.width / 2) * img.width
        const rhY = box.y * img.height - ROTATION_HANDLE_DIST / transform.zoom
        ctx.beginPath()
        ctx.moveTo(cx, cy)
        ctx.lineTo(rhX, rhY)
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 1.5 / transform.zoom
        ctx.setLineDash([])
        ctx.stroke()

        ctx.beginPath()
        ctx.arc(rhX, rhY, ROTATION_HANDLE_RADIUS / transform.zoom, 0, Math.PI * 2)
        ctx.fillStyle = '#ffffff'
        ctx.strokeStyle = '#000000'
        ctx.lineWidth = 1 / transform.zoom
        ctx.fill()
        ctx.stroke()
      }
    }

    if (mode === 'drawing' && drawStart && drawCurrent) {
      const x = Math.min(drawStart.x, drawCurrent.x)
      const y = Math.min(drawStart.y, drawCurrent.y)
      const w = Math.abs(drawCurrent.x - drawStart.x)
      const h = Math.abs(drawCurrent.y - drawStart.y)

      ctx.fillStyle = LEFT_COLOR + '33'
      ctx.fillRect(x * img.width, y * img.height, w * img.width, h * img.height)
      ctx.strokeStyle = LEFT_COLOR
      ctx.lineWidth = 2 / transform.zoom
      ctx.setLineDash([5 / transform.zoom, 5 / transform.zoom])
      ctx.strokeRect(x * img.width, y * img.height, w * img.width, h * img.height)
    }

    ctx.restore()

    if (!readOnly && boxes.length === 0 && mode === 'idle') {
      ctx.fillStyle = '#ffffff88'
      ctx.font = '14px Inter, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('Click and drag to draw a bounding box', canvas.width / 2, canvas.height / 2)
    }
  }, [boxes, selectedId, transform, imageLoaded, mode, drawStart, drawCurrent, readOnly])

  useLayoutEffect(() => {
    render()
  }, [render])

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (readOnly) return
    e.preventDefault()

    const imgPoint = toImageCoords(e.clientX, e.clientY)

    if (spaceHeld || e.button === 1) {
      setMode('panning')
      setPanStart({ x: e.clientX - transform.offsetX, y: e.clientY - transform.offsetY })
      return
    }

    if (selectedId) {
      const selectedBox = boxes.find(b => b.id === selectedId)
      if (selectedBox) {
        if (getRotateHandleAtPoint(e.clientX, e.clientY, selectedBox)) {
          setMode('rotating')
          setDragStart(imgPoint)
          setOriginalBox({ ...selectedBox })
          const centerX = selectedBox.x + selectedBox.width / 2
          const centerY = selectedBox.y + selectedBox.height / 2
          setRotateStartAngle(Math.atan2(-(imgPoint.y - centerY), imgPoint.x - centerX))
          return
        }

        const handle = getHandleAtPoint(imgPoint, selectedBox)
        if (handle) {
          setMode('resizing')
          setActiveHandle(handle)
          setDragStart(imgPoint)
          setOriginalBox({ ...selectedBox })
          return
        }
        if (pointInBox(imgPoint, selectedBox)) {
          setMode('moving')
          setDragStart(imgPoint)
          setOriginalBox({ ...selectedBox })
          return
        }
      }
    }

    for (const box of [...boxes].reverse()) {
      if (pointInBox(imgPoint, box)) {
        onSelectedChange(box.id)
        setMode('moving')
        setDragStart(imgPoint)
        setOriginalBox({ ...box })
        return
      }
    }

    onSelectedChange(null)
    setMode('drawing')
    setDrawStart(imgPoint)
    setDrawCurrent(imgPoint)
  }, [boxes, selectedId, spaceHeld, transform, toImageCoords, getHandleAtPoint, getRotateHandleAtPoint, pointInBox, onSelectedChange, readOnly])

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const imgPoint = toImageCoords(e.clientX, e.clientY)

    if (mode === 'panning' && panStart) {
      setTransform(t => ({
        ...t,
        offsetX: e.clientX - panStart.x,
        offsetY: e.clientY - panStart.y,
      }))
      return
    }

    if (mode === 'drawing' && drawStart) {
      setDrawCurrent(imgPoint)
      return
    }

    if (mode === 'moving' && dragStart && originalBox) {
      const dx = imgPoint.x - dragStart.x
      const dy = imgPoint.y - dragStart.y
      const newBox = {
        ...originalBox,
        x: Math.max(0, Math.min(1 - originalBox.width, originalBox.x + dx)),
        y: Math.max(0, Math.min(1 - originalBox.height, originalBox.y + dy)),
      }
      onBoxesChange(boxes.map(b => b.id === originalBox.id ? newBox : b))
      return
    }

    if (mode === 'resizing' && dragStart && originalBox && activeHandle) {
      let dx = imgPoint.x - dragStart.x
      let dy = imgPoint.y - dragStart.y

      if (originalBox.rotation) {
        const cos = Math.cos(originalBox.rotation)
        const sin = Math.sin(originalBox.rotation)
        const projectedDx = dx * cos + dy * sin
        const projectedDy = -dx * sin + dy * cos
        dx = projectedDx
        dy = projectedDy
      }

      let { x, y, width, height } = originalBox

      if (activeHandle.includes('w')) {
        x = Math.min(originalBox.x + originalBox.width - MIN_BOX_SIZE, originalBox.x + dx)
        width = originalBox.width - (x - originalBox.x)
      }
      if (activeHandle.includes('e')) {
        width = Math.max(MIN_BOX_SIZE, originalBox.width + dx)
      }
      if (activeHandle.includes('n')) {
        y = Math.min(originalBox.y + originalBox.height - MIN_BOX_SIZE, originalBox.y + dy)
        height = originalBox.height - (y - originalBox.y)
      }
      if (activeHandle.includes('s')) {
        height = Math.max(MIN_BOX_SIZE, originalBox.height + dy)
      }

      x = Math.max(0, x)
      y = Math.max(0, y)
      width = Math.min(width, 1 - x)
      height = Math.min(height, 1 - y)

      const newBox = { ...originalBox, x, y, width, height }
      onBoxesChange(boxes.map(b => b.id === originalBox.id ? newBox : b))
      return
    }

    if (mode === 'rotating' && dragStart && originalBox) {
      const centerX = originalBox.x + originalBox.width / 2
      const centerY = originalBox.y + originalBox.height / 2
      const rawAngle = Math.atan2(-(imgPoint.y - centerY), imgPoint.x - centerX)
      if (rotateStartAngle !== null) {
        let delta = rawAngle - rotateStartAngle
        delta = ((delta % (Math.PI * 2)) + (Math.PI * 2)) % (Math.PI * 2)
        if (delta > Math.PI) delta -= Math.PI * 2
        const newBox = { ...originalBox, rotation: delta }
        onBoxesChange(boxes.map(b => b.id === originalBox.id ? newBox : b))
      }
      return
    }

    if (!readOnly && mode === 'idle') {
      setHoverRotate(false)
      if (selectedId) {
        const selectedBox = boxes.find(b => b.id === selectedId)
        if (selectedBox) {
          if (getRotateHandleAtPoint(e.clientX, e.clientY, selectedBox)) {
            setHoverRotate(true)
            setHoverHandle(null)
            setHoverBox(null)
            return
          }
          const handle = getHandleAtPoint(imgPoint, selectedBox)
          setHoverHandle(handle)
          if (handle) {
            setHoverBox(null)
            return
          }
        }
      }
      setHoverHandle(null)
      const hoveredBox = [...boxes].reverse().find(b => pointInBox(imgPoint, b))
      setHoverBox(hoveredBox?.id || null)
    }
  }, [mode, panStart, drawStart, dragStart, originalBox, activeHandle, rotateStartAngle, boxes, selectedId, toImageCoords, getHandleAtPoint, getRotateHandleAtPoint, pointInBox, onBoxesChange, readOnly])

  const handleMouseUp = useCallback((_e: React.MouseEvent<HTMLCanvasElement>) => {
    if (mode === 'drawing' && drawStart && drawCurrent) {
      const x = Math.min(drawStart.x, drawCurrent.x)
      const y = Math.min(drawStart.y, drawCurrent.y)
      const width = Math.abs(drawCurrent.x - drawStart.x)
      const height = Math.abs(drawCurrent.y - drawStart.y)

      if (width >= MIN_BOX_SIZE && height >= MIN_BOX_SIZE) {
        const newBox: BoundingBox = {
          id: crypto.randomUUID(),
          x: Math.max(0, Math.min(1 - width, x)),
          y: Math.max(0, Math.min(1 - height, y)),
          width: Math.min(width, 1),
          height: Math.min(height, 1),
          rotation: 0,
          hand: 'left',
        }
        onBoxesChange([...boxes, newBox])
        onSelectedChange(newBox.id)
      }
    }

    setMode('idle')
    setDrawStart(null)
    setDrawCurrent(null)
    setDragStart(null)
    setOriginalBox(null)
    setActiveHandle(null)
    setPanStart(null)
    setRotateStartAngle(null)
  }, [mode, drawStart, drawCurrent, boxes, onBoxesChange, onSelectedChange])

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const handler = (e: WheelEvent) => {
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top

      setTransform(t => {
        const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1
        const nz = Math.max(0.5, Math.min(4, t.zoom * zoomFactor))
        const wx = (mouseX - t.offsetX) / t.zoom
        const wy = (mouseY - t.offsetY) / t.zoom
        return { zoom: nz, offsetX: mouseX - wx * nz, offsetY: mouseY - wy * nz }
      })
    }

    canvas.addEventListener('wheel', handler, { passive: false })
    return () => canvas.removeEventListener('wheel', handler)
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !spaceHeld) {
        e.preventDefault()
        setSpaceHeld(true)
      }
    }
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setSpaceHeld(false)
        if (mode === 'panning') {
          setMode('idle')
          setPanStart(null)
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [spaceHeld, mode])

  const getCursor = useCallback((): string => {
    if (spaceHeld || mode === 'panning') return 'grab'
    if (mode === 'drawing') return 'crosshair'
    if (mode === 'moving') return 'move'
    if (mode === 'rotating') return 'grabbing'
    if (mode === 'resizing') {
      const cursors: Record<ResizeHandle, string> = {
        nw: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', se: 'nwse-resize',
        n: 'ns-resize', s: 'ns-resize', w: 'ew-resize', e: 'ew-resize',
      }
      return activeHandle ? cursors[activeHandle] : 'default'
    }
    if (hoverRotate) return 'grab'
    if (hoverHandle) {
      const cursors: Record<ResizeHandle, string> = {
        nw: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', se: 'nwse-resize',
        n: 'ns-resize', s: 'ns-resize', w: 'ew-resize', e: 'ew-resize',
      }
      return cursors[hoverHandle]
    }
    if (hoverBox) return 'move'
    if (readOnly) return 'default'
    return 'crosshair'
  }, [spaceHeld, mode, activeHandle, hoverHandle, hoverBox, hoverRotate, readOnly])

  return (
    <div ref={containerRef} className="w-full h-full relative bg-black/40 rounded-lg overflow-hidden">
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onContextMenu={e => e.preventDefault()}
        style={{ cursor: getCursor() }}
        className="w-full h-full"
      />
      <div className="absolute bottom-2 right-2 text-xs text-muted-foreground bg-background/80 px-2 py-1 rounded">
        {Math.round(transform.zoom * 100)}%
      </div>
    </div>
  )
}
