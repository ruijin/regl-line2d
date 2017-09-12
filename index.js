'use strict'

const createRegl = require('regl')
const rgba = require('color-rgba')
const getBounds = require('array-bounds')
const extend = require('object-assign')
const getNormals = require('polyline-normals')

module.exports = createLine

function createLine (options) {
	if (!options) options = {}
	else if (typeof options === 'function') options = {regl: options}
	else if (options.length) options = {positions: options}

	// persistent variables
	let regl, viewport, range, bounds, count, scale, translate, precise,
		drawLine, colorBuffer, offsetBuffer, positionBuffer, joinBuffer, dashTexture, distanceBuffer,
		positions, joins, color, dashes, dashLength,
		stroke, thickness, join, miterLimit, cap


	// regl instance
	if (options.regl) regl = options.regl

	// container/gl/canvas case
	else {
		let opts = {}
		opts.pixelRatio = options.pixelRatio || global.devicePixelRatio

		if (options instanceof HTMLCanvasElement) opts.canvas = options
		else if (options instanceof HTMLElement) opts.container = options
		else if (options.drawingBufferWidth || options.drawingBufferHeight) opts.gl = options
		else {
			if (options.canvas) opts.canvas = options.canvas
			if (options.container) opts.container = options.container
			if (options.gl) opts.gl = options.gl
		}

		//FIXME: use fallback if not available
		opts.optionalExtensions = [
			'ANGLE_instanced_arrays',
			'OES_texture_npot'
		]

		regl = createRegl(opts)
	}

	//color per-point
	colorBuffer = regl.buffer({
		usage: 'static',
		type: 'uint8',
		data: null
	})
	offsetBuffer = regl.buffer({
		usage: 'static',
		type: 'float',
		data: [0,1, 0,-1, 1,1, 1,-1]
	})
	positionBuffer = regl.buffer({
		usage: 'dynamic',
		type: 'float',
		data: null
	})
	joinBuffer = regl.buffer({
		usage: 'dynamic',
		type: 'float',
		data: null
	})
	distanceBuffer = regl.buffer({
		usage: 'dynamic',
		type: 'float',
		data: null
	})
	dashTexture = regl.texture({
		channels: 1,
		data: [255],
		width: 1,
		height: 1,
		mag: 'nearest',
		min: 'nearest'
	})

	//init defaults
	update(extend({
		dashes: null,
		thickness: 10,
		join: 'bevel',
		miterLimit: 2,
		cap: 'square'
	}, options))


	drawLine = regl({
		primitive: 'triangle strip',
		instances: regl.prop('count'),
		count: 4,

		vert: `
		precision highp float;

		attribute vec2 start, end, joinStart, joinEnd;
		attribute vec4 color;
		attribute float lineLength, lineOffset, distance;

		uniform vec2 scale, translate;
		uniform float thickness;
		uniform vec2 pixelScale;

		varying vec4 fragColor;
		varying float fragLength;
		varying vec2 direction;

		void main() {
			direction = end - start;

			vec2 offset = (pixelScale * lineOffset) * thickness;

			vec2 position = start + direction * lineLength;

			position = 2.0 * (position + translate) * scale - 1.0;

			position += offset * joinStart * (1. - lineLength);
			position += offset * joinEnd * lineLength;

			vec2 normal = normalize(vec2(-direction.y, direction.x));
			// position += offset * normal * (1. - lineLength);
			// position += offset * normal * lineLength;

			fragColor = color / 255.;
			fragLength = distance + lineLength * length(direction) * scale.y * 50.;

			gl_Position = vec4(position, 0, 1);
		}
		`,
		frag: `
		precision mediump float;

		uniform sampler2D dashPattern;

		varying vec4 fragColor;
		varying float fragLength;
		varying vec2 direction;

		void main() {
			gl_FragColor = fragColor;
			gl_FragColor.a *= texture2D(dashPattern, vec2(fract(fragLength) * .5 + .25, 0)).r;
		}`,
		uniforms: {
			scale: () => scale,
			translate: () => translate,
			thickness: () => thickness,
			dashPattern: dashTexture,
			pixelScale: ctx => [
				ctx.pixelRatio / ctx.viewportWidth,
				ctx.pixelRatio / ctx.viewportHeight
			]
		},
		attributes: {
			lineLength: {
				buffer: offsetBuffer,
				divisor: 0,
				stride: 8,
				offset: 0
			},
			lineOffset: {
				buffer: offsetBuffer,
				divisor: 0,
				stride: 8,
				offset: 4
			},
			color: () => color.length > 4 ? {
				buffer: colorBuffer,
				divisor: 1
			} : {
				constant: color
			},
			start: {
				buffer: positionBuffer,
				stride: 8,
				offset: 0,
				divisor: 1
			},
			end: {
				buffer: positionBuffer,
				stride: 8,
				offset: 8,
				divisor: 1
			},
			distance: {
				buffer: distanceBuffer,
				divisor: 1
			},
			joinStart: {
				buffer: joinBuffer,
				stride: 8,
				offset: 0,
				divisor: 1,
			},
			joinEnd: {
				buffer: joinBuffer,
				stride: 8,
				offset: 8,
				divisor: 1
			}
		},

		blend: {
			enable: true,
			color: [0,0,0,1],
			func: {
				srcRGB:   'src alpha',
				srcAlpha: 1,
				dstRGB:   'one minus src alpha',
				dstAlpha: 'one minus src alpha'
			}
		},

		depth: {
			enable: false
		},

		scissor: {
			enable: true,
			box: ctx => {
			return viewport ? viewport : {
				x: 0, y: 0,
				width: ctx.drawingBufferWidth,
				height: ctx.drawingBufferHeight
			};
			}
		},

		viewport: ctx => {
			return !viewport ? {
				x: 0, y: 0,
				width: ctx.drawingBufferWidth,
				height: ctx.drawingBufferHeight
			} : viewport
		}
	})



	return draw

	function draw (opts) {
	    if (opts) {
	      update(opts)
	      if (opts.draw === false) return
	    }

	    if (!count) return

	    drawLine({ count, thickness })
	}

	function update (options) {
		//copy options to avoid mutation & handle aliases
		options = {
			positions: options.positions || options.data || options.points,
			thickness: options.lineWidth || options.lineWidths || options.linewidth || options.width || options.thickness,
			join: options.lineJoin || options.linejoin || options.join,
			miterLimit: options.miterlimit || options.miterLimit,
			dashes: options.dashes || options.dash,
			color: options.colors || options.color,
			range: options.bounds || options.range,
			viewport: options.viewport,
			precise: options.hiprecision || options.precise
		}

	    if (options.length != null) options = {positions: options}

		if (options.thickness != null) {
			thickness = +options.thickness
		}

		if (options.join) {
			join = options.join
		}

		if (options.miterLimit) {
			miterLimit = options.miterLimit
		}

		//update positions
		if (options.positions && options.positions.length) {
			//unroll
			let unrolled, coords
			if (options.positions[0].length) {
				unrolled = Array(options.positions.length)
				for (let i = 0, l = options.positions.length; i<l; i++) {
				unrolled[i*2] = options.positions[i][0]
				unrolled[i*2+1] = options.positions[i][1]
				}
				coords = options.positions
			}
			//roll
			else {
				unrolled = options.positions
				coords = []
				for (let i = 0, l = unrolled.length; i < l; i+=2) {
					coords.push([
						unrolled[i],
						unrolled[i+1]
					])
				}
			}

			positions = unrolled
			count = Math.floor(positions.length / 2)
			bounds = getBounds(positions, 2)


			let positionData = Array(count * 2 + 2)
			for (let i = 0, l = count; i < l; i++) {
				positionData[i*2+0] = coords[i][0]
				positionData[i*2+1] = coords[i][1]
			}
			positionBuffer(positionData)

			let distanceData = Array(count)
			distanceData[0] = 0
			for (let i = 1; i < count; i++) {
				let dx = coords[i][0] - coords[i-1][0]
				let dy = coords[i][1] - coords[i-1][1]
				distanceData[i] = distanceData[i-1] + Math.sqrt(dx*dx + dy*dy)
			}
			distanceBuffer(distanceData)

			joins = getNormals(coords)

			let joinData = Array(count * 2 + 2)
			for (let i = 0, l = count; i < l; i++) {
				let join = joins[i]
				let miterLen = join[1]
				joinData[i*2] = join[0][0] * miterLen
				joinData[i*2+1] = join[0][1] * miterLen
			}
			joinBuffer(joinData)
		}

		//process colors
		if (options.colors) options.color = options.colors
		if (options.color) {
			let colors = options.color

			if (!Array.isArray(colors)) {
				colors = [colors]
			}

			if (colors.length > 1 && colors.length != count) throw Error('Not enough colors')

			if (colors.length > 1) {
				color = new Uint8Array(count * 4)

				//convert colors to float arrays
				for (let i = 0; i < colors.length; i++) {
				  if (typeof colors[i] === 'string') {
				    colors[i] = rgba(colors[i], false)
				  }
				  color[i*4] = colors[i][0]
				  color[i*4 + 1] = colors[i][1]
				  color[i*4 + 2] = colors[i][2]
				  color[i*4 + 3] = colors[i][3] * 255
				}
				colorBuffer(color)
			}
			else {
				color = rgba(colors[0], false)
				color[3] *= 255
				color = new Uint8Array(color)
			}
		}

		//generate dash texture
		if (options.dashes !== undefined) {
			dashes = options.dashes
			dashLength = 0

			if (dashes.length < 2) {
				dashTexture = regl.texture({
					channels: 1,
					data: [255],
					width: 1,
					height: 1,
					mag: 'linear',
					min: 'linear'
				})
			}

			else {
				for(let i = 0; i < dashes.length; ++i) {
					dashLength += dashes[i]
				}
				let dashData = new Uint8Array(dashLength * 8)
				let ptr = 0
				let fillColor = 255

				//repeat texture two times to provide smooth 0-step
				for (let k = 0; k < 2; k++) {
					for(let i = 0; i < dashes.length; ++i) {
						for(let j = 0, l = dashes[i] * 4; j < l; ++j) {
						  dashData[ptr++] = fillColor
						}
						fillColor ^= 255
					}
				}
				dashTexture = regl.texture({
					channels: 1,
					data: dashData,
					width: dashLength * 8,
					height: 1,
					mag: 'linear',
					min: 'linear'
				})
			}
		}

		if (!options.range && !range) options.range = bounds

		//update range
		if (options.range) {
			range = options.range

			if (precise) {
				let boundX = bounds[2] - bounds[0],
				    boundY = bounds[3] - bounds[1]

				let nrange = [
				  (range[0] - bounds[0]) / boundX,
				  (range[1] - bounds[1]) / boundY,
				  (range[2] - bounds[0]) / boundX,
				  (range[3] - bounds[1]) / boundY
				]

				scale = [1 / (nrange[2] - nrange[0]), 1 / (nrange[3] - nrange[1])]
				translate = [-nrange[0], -nrange[1]]
				// scaleFract = fract32(scale)
				// translateFract = fract32(translate)
			}
			else {
				scale = [1 / (range[2] - range[0]), 1 / (range[3] - range[1])]
				translate = [-range[0], -range[1]]

				// scaleFract = [0, 0]
				// translateFract = [0, 0]
			}
		}

		//update visible attribs
		if ('viewport' in options) {
			let vp = options.viewport
			if (Array.isArray(vp)) {
			viewport = {
				x: vp[0],
				y: vp[1],
				width: vp[2] - vp[0],
				height: vp[3] - vp[1]
			}
			}
			else if (vp) {
				viewport = {
					x: vp.x || vp.left || 0,
					y: vp.y || vp.top || 0
				}

				if (vp.right) viewport.width = vp.right - viewport.x
				else viewport.width = vp.w || vp.width || 0

				if (vp.bottom) viewport.height = vp.bottom - viewport.y
				else viewport.height = vp.h || vp.height || 0
			}
		}
	}
}
