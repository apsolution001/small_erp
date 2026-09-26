import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

describe('smoke', () => {
  it('renders', () => {
    render(<h1>Ekaro</h1>);
    expect(screen.getByRole('heading', { name: 'Ekaro' })).toBeInTheDocument();
  });
});
