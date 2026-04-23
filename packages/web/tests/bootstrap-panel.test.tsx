import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BootstrapPanel } from '../src/components/bootstrap-panel';

const bootstrap = {
  baselineRunId: null,
  manualContext: [{ source: 'operator', text: 'Track repositories.' }],
  persona: {},
  recommendedConnectors: ['demo'],
  status: 'in_progress',
};

describe('BootstrapPanel', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('falls back to the default persona name and ignores blank manual context', async () => {
    const onSavePersona = vi.fn(async () => undefined);
    const onAddManualContext = vi.fn(async () => undefined);
    const onStartBaseline = vi.fn(async () => undefined);

    render(
      <BootstrapPanel
        bootstrap={bootstrap}
        onAddManualContext={onAddManualContext}
        onSavePersona={onSavePersona}
        onStartBaseline={onStartBaseline}
      />,
    );

    expect(screen.getByLabelText('Persona name')).toHaveValue('Digital Life');

    fireEvent.click(screen.getByRole('button', { name: 'Add context' }));
    expect(onAddManualContext).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Save persona' }));
    await waitFor(() => expect(onSavePersona).toHaveBeenCalledWith('Digital Life'));
  });

  it('submits persona, manual context, and baseline actions successfully', async () => {
    const onSavePersona = vi.fn(async () => undefined);
    const onAddManualContext = vi.fn(async () => undefined);
    const onStartBaseline = vi.fn(async () => undefined);

    render(
      <BootstrapPanel
        bootstrap={{
          ...bootstrap,
          baselineRunId: 'run-1',
          manualContext: [
            { source: 'operator', text: 'One' },
            { source: 'operator', text: 'Two' },
            { source: 'operator', text: 'Three' },
            { source: 'operator', text: 'Four' },
          ],
          persona: { name: 'Operator Persona' },
        }}
        onAddManualContext={onAddManualContext}
        onSavePersona={onSavePersona}
        onStartBaseline={onStartBaseline}
      />,
    );

    expect(screen.getByText('Baseline run: run-1')).toBeInTheDocument();
    expect(screen.queryByText('One')).not.toBeInTheDocument();
    expect(screen.getByText('Four')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Persona name'), {
      target: { value: 'Updated Persona' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save persona' }));
    await waitFor(() => expect(onSavePersona).toHaveBeenCalledWith('Updated Persona'));

    fireEvent.change(screen.getByLabelText('Manual context'), {
      target: { value: 'Seed this into the bootstrap context.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add context' }));
    await waitFor(() =>
      expect(onAddManualContext).toHaveBeenCalledWith('Seed this into the bootstrap context.'),
    );
    await waitFor(() => expect(screen.getByLabelText('Manual context')).toHaveValue(''));

    fireEvent.click(screen.getByRole('button', { name: 'Start baseline learning' }));
    await waitFor(() => expect(onStartBaseline).toHaveBeenCalled());
  });

  it('shows action-specific errors', async () => {
    const onSavePersona = vi.fn(async () => {
      throw new Error('Persona failed');
    });
    const onAddManualContext = vi.fn(async () => {
      throw new Error('Context failed');
    });
    const onStartBaseline = vi.fn(async () => {
      throw new Error('Baseline failed');
    });

    render(
      <BootstrapPanel
        bootstrap={bootstrap}
        onAddManualContext={onAddManualContext}
        onSavePersona={onSavePersona}
        onStartBaseline={onStartBaseline}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save persona' }));
    await waitFor(() => expect(screen.getByText('Persona failed')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Manual context'), {
      target: { value: 'Broken context' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add context' }));
    await waitFor(() => expect(screen.getByText('Context failed')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Start baseline learning' }));
    await waitFor(() => expect(screen.getByText('Baseline failed')).toBeInTheDocument());
  });
});
