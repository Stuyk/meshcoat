import { describe, it, expect } from 'vitest'
import { parseCssColor } from './colorUtils'

describe('parseCssColor', () => {
  it.each([
    ['#ff0000', '#ff0000'],
    ['ff0000', '#ff0000'],
    ['##FF0000', '#ff0000'],
    ['#f00', '#ff0000'],
    ['#f00c', '#ff0000'],
    ['#11223344', '#112233'],
    ['  #ABCDEF  ', '#abcdef'],
    ['rgb(255, 128, 0)', '#ff8000'],
    ['rgba(255,128,0,0.5)', '#ff8000'],
    ['rgb(255 128 0 / 50%)', '#ff8000'],
    ['rgb(100%, 0%, 0%)', '#ff0000'],
    ['hsl(0, 100%, 50%)', '#ff0000'],
    ['hsl(120 100% 25%)', '#008000'],
    ['hsla(240, 100%, 50%, 0.3)', '#0000ff'],
    ['hsl(0, 0%, 100%)', '#ffffff'],
    ['rebeccapurple', '#663399'],
    ['White', '#ffffff']
  ])('%s -> %s', (input, expected) => {
    expect(parseCssColor(input)).toBe(expected)
  })

  it.each(['', 'nope', '#12', '#12345', 'rgb(1,2)', 'rgb(a,b,c)'])('rejects %s', (input) => {
    expect(parseCssColor(input)).toBeNull()
  })
})
