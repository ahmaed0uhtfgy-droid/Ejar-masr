import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import { ErrorBoundary } from './ErrorBoundary'

function Boom(): never { throw new Error('boom') }

describe('ErrorBoundary', () => {
  it('shows a friendly screen with a reload button instead of a blank page', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(<ErrorBoundary><Boom /></ErrorBoundary>)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'تحديث الصفحة' })).toBeInTheDocument()
  })
  it('renders children untouched when nothing fails', () => {
    render(<ErrorBoundary><p>ok</p></ErrorBoundary>)
    expect(screen.getByText('ok')).toBeInTheDocument()
  })
})
