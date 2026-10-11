import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SapLookupModal from './SapLookupModal';

const columns = [
  { key: 'code', label: 'Code' },
  { key: 'name', label: 'Name' },
];

test('renders rows and chooses the selected row', () => {
  const onSelect = jest.fn();

  render(
    <SapLookupModal
      open
      title="List of Values"
      columns={columns}
      rows={[{ code: 'A1', name: 'Alpha' }]}
      onClose={jest.fn()}
      onSelect={onSelect}
    />,
  );

  fireEvent.click(screen.getByText('Alpha'));
  fireEvent.click(screen.getByText('Choose'));

  expect(onSelect).toHaveBeenCalledWith({ code: 'A1', name: 'Alpha' });
});

test('renders inside the app content portal and closes on Escape', () => {
  const onClose = jest.fn();
  const appContent = document.createElement('div');
  appContent.className = 'app-shell__content';
  document.body.appendChild(appContent);

  render(
    <SapLookupModal
      open
      title="Contained List"
      columns={columns}
      rows={[{ code: 'A1', name: 'Alpha' }]}
      onClose={onClose}
      onSelect={jest.fn()}
    />,
  );

  expect(appContent.querySelector('.sap-lookup-modal__overlay')).toBeInTheDocument();

  fireEvent.keyDown(window, { key: 'Escape' });

  expect(onClose).toHaveBeenCalled();
  appContent.remove();
});

test('renders loading and empty states', () => {
  const { rerender } = render(
    <SapLookupModal open title="List" columns={columns} rows={[]} loading onClose={jest.fn()} onSelect={jest.fn()} />,
  );

  expect(screen.getByText('Loading...')).toBeInTheDocument();

  rerender(
    <SapLookupModal open title="List" columns={columns} rows={[]} onClose={jest.fn()} onSelect={jest.fn()} />,
  );

  expect(screen.getByText('No matching records found.')).toBeInTheDocument();
});

test('filters provided rows with the Find field', () => {
  render(
    <SapLookupModal
      open
      title="List"
      columns={columns}
      rows={[
        { code: 'A1', name: 'Alpha' },
        { code: 'B2', name: 'Beta' },
      ]}
      onClose={jest.fn()}
      onSelect={jest.fn()}
    />,
  );

  fireEvent.change(screen.getByLabelText('Find'), { target: { value: 'beta' } });

  expect(screen.queryByText('Alpha')).not.toBeInTheDocument();
  expect(screen.getByText('Beta')).toBeInTheDocument();
});

test('filters provided rows with SAP-style exact and similar matching', () => {
  render(
    <SapLookupModal
      open
      title="List"
      columns={columns}
      rows={[
        { code: 'DC0606', name: '"SACHIN RADHESHAM ZANWAR "' },
        { code: 'DC0580', name: 'MAMTA SACHIN ZANWAR' },
      ]}
      onClose={jest.fn()}
      onSelect={jest.fn()}
    />,
  );

  fireEvent.change(screen.getByLabelText('Find'), { target: { value: '"SACHIN RADHESHAM ZANWAR"' } });

  expect(screen.getByText('"SACHIN RADHESHAM ZANWAR "')).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText('Find'), { target: { value: 'zanwar sachin' } });

  expect(screen.getByText('"SACHIN RADHESHAM ZANWAR "')).toBeInTheDocument();
  expect(screen.getByText('MAMTA SACHIN ZANWAR')).toBeInTheDocument();
});

test('fetches rows from a query and renders optional new action', async () => {
  const fetchOptions = jest.fn().mockResolvedValue([{ code: 'B2', name: 'Beta' }]);

  render(
    <SapLookupModal
      open
      title="List"
      columns={columns}
      fetchOptions={fetchOptions}
      onClose={jest.fn()}
      onSelect={jest.fn()}
      onNew={jest.fn()}
    />,
  );

  expect(await screen.findByText('Beta')).toBeInTheDocument();
  expect(screen.getByText('New')).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText('Find'), { target: { value: 'B' } });
  await waitFor(() => expect(fetchOptions).toHaveBeenCalledWith('B'));
});

test('hides new action when no handler is provided', () => {
  render(
    <SapLookupModal
      open
      title="List"
      columns={columns}
      rows={[]}
      onClose={jest.fn()}
      onSelect={jest.fn()}
    />,
  );

  expect(screen.queryByText('New')).not.toBeInTheDocument();
});

test('loads further server pages beyond the first lookup page', async () => {
  const fetchOptions = jest.fn((_query, { skip }) => Promise.resolve(
    skip === 0
      ? [{ code: 'A1', name: 'Alpha' }, { code: 'B2', name: 'Beta' }]
      : [{ code: 'C3', name: 'Gamma' }],
  ));

  render(
    <SapLookupModal open title="List" columns={columns} fetchOptions={fetchOptions}
      pageSize={2} onClose={jest.fn()} onSelect={jest.fn()} />,
  );

  expect(await screen.findByText('Beta')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Load more'));
  expect(await screen.findByText('Gamma')).toBeInTheDocument();
  expect(fetchOptions).toHaveBeenCalledWith('', { skip: 2, top: 2 });
  expect(screen.queryByText('Load more')).not.toBeInTheDocument();
});

test('searches the full server dataset instead of only the loaded page', async () => {
  const fetchOptions = jest.fn((query, { skip }) => Promise.resolve(
    query === 'Z999'
      ? [{ code: 'Z999', name: 'Item beyond first page' }]
      : skip === 0
        ? [{ code: 'A1', name: 'Alpha' }, { code: 'B2', name: 'Beta' }]
        : [{ code: 'C3', name: 'Gamma' }],
  ));

  render(
    <SapLookupModal open title="List of Items" columns={columns} fetchOptions={fetchOptions}
      pageSize={2} searchLabel="Find in all records" onClose={jest.fn()} onSelect={jest.fn()} />,
  );

  expect(await screen.findByText('Beta')).toBeInTheDocument();
  const listBody = screen.getByText('Beta').closest('.sap-lookup-modal__body');
  listBody.scrollTop = 300;
  fireEvent.change(screen.getByLabelText('Find in all records'), { target: { value: 'Z999' } });

  expect(await screen.findByText('Item beyond first page')).toBeInTheDocument();
  expect(listBody.scrollTop).toBe(0);
  expect(fetchOptions).toHaveBeenCalledWith('Z999', { skip: 0, top: 2 });
  expect(screen.queryByText('Alpha')).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('Clear'));
  expect(await screen.findByText('Alpha')).toBeInTheDocument();
});

test('starts a lookup with text entered in its source field before Tab', async () => {
  window.__sapB1PendingLookupQuery = 'Z999';
  try {
    render(
      <SapLookupModal open title="List of Items" columns={columns}
        rows={[{ code: 'A1', name: 'Alpha' }, { code: 'Z999', name: 'Remote item' }]}
        onClose={jest.fn()} onSelect={jest.fn()} />,
    );
    expect(screen.getByLabelText('Find')).toHaveValue('Z999');
    expect(screen.getByText('Remote item')).toBeInTheDocument();
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument();
  } finally {
    window.__sapB1PendingLookupQuery = '';
  }
});
