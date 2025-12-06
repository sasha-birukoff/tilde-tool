// ============================================================================
// Tilde Graph Architect - Pure JavaScript Graph Visualization
// ============================================================================

// Configuration defaults
const config = {
    svgWidth: 1400,
    svgHeight: 1400,
    marginLeft: 100,
    marginRight: 100,
    marginTop: 100,
    marginBottom: 100,
    columnSpacing: 1.0,
    rowSpacing: 1.0,
    lineThickness: 0.5,
    lineColor: '#939393',
    nodeBaseSize: 3.5,
    nodeScaleK: 0.5,
    nodeColor: '#939393',
    mergeTolerance: 1,
    showEdgeNodes: true,
    bgColor: '#000000',
};

let lastSvg = '';

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Parse nodes per column input string (e.g., "1,5,6")
 * Returns array of integers, each clamped to [1, 8]
 * Overall array length clamped to [2, 6]
 */
function parseNodesPerColumn(inputStr) {
    if (!inputStr || inputStr.trim() === '') {
        return [1, 5, 6]; // default
    }

    const parts = inputStr.split(',').map(s => s.trim()).filter(s => s !== '');
    const nums = parts.map(s => {
        const n = parseInt(s, 10);
        return isNaN(n) ? 0 : Math.max(1, Math.min(8, n));
    }).filter(n => n > 0);

    if (nums.length === 0) {
        return [1, 5, 6]; // fallback default
    }

    // Clamp to 2-7 columns
    const clamped = nums.slice(0, 7);
    if (clamped.length < 2) {
        // Pad with 1s to reach 2 columns
        while (clamped.length < 2) {
            clamped.push(1);
        }
    }

    return clamped;
}

/**
 * Read all control inputs and update config object
 */
function readControlsToConfig() {
    // Get nodes from individual digit inputs
    const digitInputs = document.querySelectorAll('.nodes-input-digit');
    const nodesInput = Array.from(digitInputs).map(input => input.value).filter(v => v).join(',');

    config.columnSpacing = parseFloat(document.getElementById('columnSpacing').value) || 1.0;
    config.rowSpacing = parseFloat(document.getElementById('rowSpacing').value) || 1.0;
    config.lineThickness = parseFloat(document.getElementById('lineThickness').value) || 0.5;
    config.nodeBaseSize = parseFloat(document.getElementById('nodeBaseSize').value) || 2;
    config.nodeScaleK = parseFloat(document.getElementById('nodeScaleK').value) || 0.4;
    config.mergeTolerance = parseFloat(document.getElementById('mergeTolerance').value) || 1;
    config.showEdgeNodes = document.getElementById('showEdgeNodes').checked;
    config.lineColor = document.getElementById('lineColor').value;
    config.nodeColor = document.getElementById('nodeColor').value;
    config.bgColor = document.getElementById('bgColor').value;

    config.nodesPerColumn = parseNodesPerColumn(nodesInput);
}

/**
 * Generate nodes for each column
 * Returns { nodes, columns }
 * nodes: array of { id, colIndex, rowIndex, x, y, degree }
 * columns: array of node indices for each column
 */
function generateNodes(cfg) {
    const nodes = [];
    const columns = [];
    let nodeId = 0;

    const innerWidth = cfg.svgWidth - cfg.marginLeft - cfg.marginRight;
    const innerHeight = cfg.svgHeight - cfg.marginTop - cfg.marginBottom;

    cfg.nodesPerColumn.forEach((nodeCount, colIndex) => {
        const colNodes = [];

        // Horizontal position: evenly spaced with configurable spacing multiplier
        const spacingFraction = cfg.nodesPerColumn.length > 1
            ? (colIndex / (cfg.nodesPerColumn.length - 1)) * cfg.columnSpacing
            : 0;
        const colX = cfg.marginLeft + spacingFraction * innerWidth;

        // Vertical positions: evenly spaced within margins with configurable spacing multiplier
        for (let rowIndex = 0; rowIndex < nodeCount; rowIndex++) {
            let nodeY;
            if (nodeCount === 1) {
                nodeY = cfg.svgHeight / 2;
            } else {
                const fraction = rowIndex / (nodeCount - 1);
                const spacingFraction = fraction * cfg.rowSpacing;
                nodeY = cfg.marginTop + spacingFraction * innerHeight;
            }

            const node = {
                id: nodeId,
                colIndex,
                rowIndex,
                x: colX,
                y: nodeY,
                degree: 0,
            };

            nodes.push(node);
            colNodes.push(nodeId);
            nodeId++;
        }

        columns.push(colNodes);
    });

    return { nodes, columns };
}

/**
 * Generate edges between adjacent columns (complete bipartite)
 * Updates node degree counts
 */
function generateEdges(nodes, columns) {
    const edges = [];

    for (let colIdx = 0; colIdx < columns.length - 1; colIdx++) {
        const col1 = columns[colIdx];
        const col2 = columns[colIdx + 1];

        for (const nodeId1 of col1) {
            for (const nodeId2 of col2) {
                edges.push({ a: nodeId1, b: nodeId2 });
                nodes[nodeId1].degree++;
                nodes[nodeId2].degree++;
            }
        }
    }

    return edges;
}

/**
 * Line segment intersection test
 * Returns { x, y } if segments intersect inside both ranges, null otherwise
 */
function lineSegmentIntersection(p1, p2, p3, p4) {
    const x1 = p1.x, y1 = p1.y;
    const x2 = p2.x, y2 = p2.y;
    const x3 = p3.x, y3 = p3.y;
    const x4 = p4.x, y4 = p4.y;

    const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (Math.abs(denom) < 1e-10) {
        return null; // parallel or coincident
    }

    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
    const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;

    // Both t and u must be in (0, 1) for interior intersection
    if (t > 0 && t < 1 && u > 0 && u < 1) {
        const ix = x1 + t * (x2 - x1);
        const iy = y1 + t * (y2 - y1);
        return { x: ix, y: iy };
    }

    return null;
}

/**
 * Compute all line–line intersections and merge nearby ones
 * Returns array of { x, y, count }
 */
function computeIntersections(nodes, edges, cfg) {
    const intersections = [];

    // Loop over all unordered pairs of edges
    for (let i = 0; i < edges.length; i++) {
        for (let j = i + 1; j < edges.length; j++) {
            const e1 = edges[i];
            const e2 = edges[j];

            // Skip if they share an endpoint
            if (e1.a === e2.a || e1.a === e2.b || e1.b === e2.a || e1.b === e2.b) {
                continue;
            }

            // Compute intersection
            const p1 = nodes[e1.a];
            const p2 = nodes[e1.b];
            const p3 = nodes[e2.a];
            const p4 = nodes[e2.b];

            const intersection = lineSegmentIntersection(p1, p2, p3, p4);
            if (!intersection) {
                continue;
            }

            // Merge nearby intersections
            let merged = false;
            for (const existing of intersections) {
                const dist = Math.sqrt(
                    (existing.x - intersection.x) ** 2 +
                    (existing.y - intersection.y) ** 2
                );
                if (dist < cfg.mergeTolerance) {
                    existing.count++;
                    merged = true;
                    break;
                }
            }

            if (!merged) {
                intersections.push({
                    x: intersection.x,
                    y: intersection.y,
                    count: 1,
                });
            }
        }
    }

    return intersections;
}

/**
 * Build SVG markup string with auto-sizing
 */
function buildSvg(nodes, edges, intersections, cfg) {
    let svgContent = '';

    // Draw lines (edges)
    for (const edge of edges) {
        const node1 = nodes[edge.a];
        const node2 = nodes[edge.b];
        svgContent += `<line x1="${node1.x}" y1="${node1.y}" x2="${node2.x}" y2="${node2.y}" ` +
            `stroke="${cfg.lineColor}" stroke-width="${cfg.lineThickness}" fill="none" />`;
    }

    // Draw intersection squares
    // Sized same way as nodes: baseSize + scaleK * degree
    // For intersections, degree = count (number of lines crossing)
    for (const inter of intersections) {
        const size = cfg.nodeBaseSize + cfg.nodeScaleK * inter.count;
        if (size > 0) {
            const half = size / 2;
            svgContent += `<rect x="${inter.x - half}" y="${inter.y - half}" ` +
                `width="${size}" height="${size}" fill="${cfg.nodeColor}" />`;
        }
    }

    // Draw node squares (endpoint markers)
    for (const node of nodes) {
        // Skip edge nodes if showEdgeNodes is false
        if (!cfg.showEdgeNodes) {
            const isLeftmost = node.colIndex === 0;
            const isRightmost = node.colIndex === cfg.nodesPerColumn.length - 1;
            if (isLeftmost || isRightmost) {
                continue;
            }
        }

        const size = cfg.nodeBaseSize + cfg.nodeScaleK * node.degree;
        if (size > 0) {
            const half = size / 2;
            svgContent += `<rect x="${node.x - half}" y="${node.y - half}" ` +
                `width="${size}" height="${size}" fill="${cfg.nodeColor}" />`;
        }
    }

    // Calculate content bounds
    let minX = cfg.svgWidth, maxX = 0, minY = cfg.svgHeight, maxY = 0;

    for (const node of nodes) {
        const size = cfg.nodeBaseSize + cfg.nodeScaleK * node.degree;
        const half = size / 2;
        minX = Math.min(minX, node.x - half);
        maxX = Math.max(maxX, node.x + half);
        minY = Math.min(minY, node.y - half);
        maxY = Math.max(maxY, node.y + half);
    }

    for (const inter of intersections) {
        const interBaseSize = cfg.nodeBaseSize + cfg.nodeScaleK;
        const size = interBaseSize + cfg.nodeScaleK * inter.count;
        const half = size / 2;
        minX = Math.min(minX, inter.x - half);
        maxX = Math.max(maxX, inter.x + half);
        minY = Math.min(minY, inter.y - half);
        maxY = Math.max(maxY, inter.y + half);
    }

    // Account for line thickness
    const padding = cfg.lineThickness / 2;
    minX -= padding;
    maxX += padding;
    minY -= padding;
    maxY += padding;

    const width = maxX - minX;
    const height = maxY - minY;

    // Wrap in SVG element with calculated bounds
    const svg = `<svg width="${width}" height="${height}" viewBox="${minX} ${minY} ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
${svgContent}
</svg>`;

    return svg;
}

/**
 * Main render function
 */
function render() {
    readControlsToConfig();

    const { nodes, columns } = generateNodes(config);
    const edges = generateEdges(nodes, columns);
    const intersections = computeIntersections(nodes, edges, config);

    lastSvg = buildSvg(nodes, edges, intersections, config);

    const preview = document.getElementById('preview');
    preview.innerHTML = lastSvg;
    preview.style.backgroundColor = config.bgColor;
}

/**
 * Reset all controls to default values
 */
function resetToDefaults() {
    // Reset nodes per column to 1,5,6
    const digitInputs = document.querySelectorAll('.nodes-input-digit');
    digitInputs[0].value = '1';
    digitInputs[1].value = '5';
    digitInputs[2].value = '6';
    for (let i = 3; i < digitInputs.length; i++) {
        digitInputs[i].value = '';
    }

    // Reset all sliders and other controls
    document.getElementById('columnSpacing').value = 1.0;
    document.getElementById('columnSpacingValue').textContent = '1.00';

    document.getElementById('rowSpacing').value = 1.0;
    document.getElementById('rowSpacingValue').textContent = '1.00';

    document.getElementById('lineThickness').value = 0.5;
    document.getElementById('lineThicknessValue').textContent = '0.50';

    document.getElementById('nodeBaseSize').value = 3.5;
    document.getElementById('nodeBaseSizeValue').textContent = '3.50';

    document.getElementById('nodeScaleK').value = 0.5;
    document.getElementById('nodeScaleKValue').textContent = '0.50';

    document.getElementById('mergeTolerance').value = 1;
    document.getElementById('mergeToleranceValue').textContent = '1.00';

    document.getElementById('showEdgeNodes').checked = true;

    // Reset colors
    document.getElementById('lineColor').value = '#939393';
    document.getElementById('lineColorHex').value = '#939393';

    document.getElementById('nodeColor').value = '#939393';
    document.getElementById('nodeColorHex').value = '#939393';

    document.getElementById('bgColor').value = '#000000';
    document.getElementById('bgColorHex').value = '#000000';

    // Re-render with defaults
    render();
}

/**
 * Download SVG as file
 */
function downloadSvg() {
    if (!lastSvg) {
        alert('No SVG to download. Please click "Regenerate" first.');
        return;
    }

    const blob = new Blob([lastSvg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'tilde-graph.svg';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

// ============================================================================
// Initialize on Page Load
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
    // Set up color picker and HEX input synchronization
    const colorPairs = [
        { picker: 'lineColor', hex: 'lineColorHex' },
        { picker: 'nodeColor', hex: 'nodeColorHex' },
        { picker: 'bgColor', hex: 'bgColorHex' }
    ];

    colorPairs.forEach(({ picker, hex }) => {
        const pickerElem = document.getElementById(picker);
        const hexElem = document.getElementById(hex);

        // When color picker changes, update HEX input
        pickerElem.addEventListener('input', (e) => {
            hexElem.value = e.target.value.toUpperCase();
            render();
        });

        // When HEX input changes, update color picker
        hexElem.addEventListener('input', (e) => {
            let value = e.target.value.trim();
            // Add # if missing
            if (value && !value.startsWith('#')) {
                value = '#' + value;
            }
            // Validate hex format
            if (/^#[0-9A-F]{6}$/i.test(value)) {
                pickerElem.value = value;
                hexElem.value = value.toUpperCase();
                render();
            }
        });
    });

    // Set up nodes per column digit inputs
    const digitInputs = document.querySelectorAll('.nodes-input-digit');
    digitInputs.forEach((input, index) => {
        input.addEventListener('input', (e) => {
            // Only allow digits 0-9
            e.target.value = e.target.value.replace(/[^0-9]/g, '').slice(0, 1);

            // Move to next input if a digit was entered
            if (e.target.value && index < digitInputs.length - 1) {
                digitInputs[index + 1].focus();
            }

            render();
        });

        input.addEventListener('keydown', (e) => {
            // Handle backspace to move to previous input
            if (e.key === 'Backspace' && !input.value) {
                if (index > 0) {
                    digitInputs[index - 1].focus();
                }
            }
        });

        input.addEventListener('focus', (e) => {
            // Select all text on focus
            e.target.select();
        });
    });

    // Reset to defaults on page load
    resetToDefaults();

    // Button event listeners
    document.getElementById('resetBtn').addEventListener('click', resetToDefaults);
    document.getElementById('downloadBtn').addEventListener('click', downloadSvg);

    // Map of slider IDs to their value input IDs
    const sliderValueMap = {
        'columnSpacing': 'columnSpacingValue',
        'rowSpacing': 'rowSpacingValue',
        'lineThickness': 'lineThicknessValue',
        'nodeBaseSize': 'nodeBaseSizeValue',
        'nodeScaleK': 'nodeScaleKValue',
        'mergeTolerance': 'mergeToleranceValue'
    };

    // Set up synchronized slider and input controls
    Object.entries(sliderValueMap).forEach(([sliderId, inputId]) => {
        const slider = document.getElementById(sliderId);
        const input = document.getElementById(inputId);

        if (slider && input) {
            // When slider changes, update input
            slider.addEventListener('input', (e) => {
                const value = parseFloat(e.target.value);
                input.value = value.toFixed(2);
                render();
            });

            // Select all text on focus (click or tab)
            input.addEventListener('focus', (e) => {
                setTimeout(() => {
                    e.target.select();
                }, 0);
            });

            // When input changes, update slider
            input.addEventListener('input', (e) => {
                let value = parseFloat(e.target.value);

                // Only update if we have a valid number
                if (!isNaN(value)) {
                    // Clamp to min/max
                    const min = parseFloat(slider.min);
                    const max = parseFloat(slider.max);
                    value = Math.max(min, Math.min(max, value));

                    slider.value = value;
                }
            });

            // When input loses focus, ensure it's properly formatted and render
            input.addEventListener('blur', (e) => {
                let value = parseFloat(e.target.value);
                const min = parseFloat(slider.min);
                const max = parseFloat(slider.max);
                value = Math.max(min, Math.min(max, value || 0));
                input.value = value.toFixed(2);
                slider.value = value;
                render();
            });

            // Allow Enter key to confirm and blur
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    input.blur();
                }
            });
        }
    });

    // Real-time preview update on control changes
    const controls = [
        'showEdgeNodes', 'lineColor', 'nodeColor', 'bgColor'
    ];

    controls.forEach(id => {
        const elem = document.getElementById(id);
        if (elem) {
            if (elem.type === 'checkbox') {
                elem.addEventListener('change', render);
            } else {
                elem.addEventListener('input', render);
            }
        }
    });
});
