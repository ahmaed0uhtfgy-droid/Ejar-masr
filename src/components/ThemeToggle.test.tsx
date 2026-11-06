import { fireEvent, render, screen } from '@testing-library/react'
import { ThemeToggle } from './ThemeToggle'

describe('dark mode', () => {
  beforeEach(() => { document.documentElement.classList.remove('dark'); localStorage.clear() })
  it('toggles the dark class and persists the choice', () => {
    render(<ThemeToggle />)
    fireEvent.click(screen.getByRole('button'))
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(localStorage.getItem('theme')).toBe('dark')
    fireEvent.click(screen.getByRole('button'))
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(localStorage.getItem('theme')).toBe('light')
  })
})
