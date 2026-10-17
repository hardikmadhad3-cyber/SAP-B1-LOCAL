import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import LocalSetup from './LocalSetup';
import api from '../../api/client';

let mockKind = 'item-groups';
jest.mock('react-router-dom',()=>({useParams:()=>({kind:mockKind})}),{virtual:true});
jest.mock('../../api/client',()=>({get:jest.fn(),post:jest.fn(),patch:jest.fn()}));
beforeEach(()=>{
  jest.clearAllMocks();
  global.structuredClone = (value)=>JSON.parse(JSON.stringify(value));
  api.get.mockResolvedValue({data:{rows:[],accounts:[],branches:[],periods:[],defaults:[]}});
  api.post.mockResolvedValue({data:{success:true}});
  api.patch.mockResolvedValue({data:{success:true}});
});

test('item group form saves to the existing setup endpoint',async()=>{
  mockKind='item-groups';render(<LocalSetup/>);
  await screen.findByText('No records yet.');
  fireEvent.change(screen.getByLabelText('Group name'),{target:{value:'Finished Goods'}});
  fireEvent.click(screen.getByRole('button',{name:'Save'}));
  await screen.findByText('Saved successfully.');
  expect(api.post).toHaveBeenCalledWith('/local-setup/item-groups',expect.objectContaining({ItmsGrpNam:'Finished Goods',Locked:'N'}));
});

test('state edit preserves composite country/code identity and reports server errors',async()=>{
  mockKind='states';api.get.mockResolvedValue({data:{rows:[{Country:'IN',Code:'GJ',Name:'Gujarat'}],countries:[{Code:'IN',Name:'India'}]}});
  api.patch.mockRejectedValue({response:{data:{message:'State update refused.'}}});
  render(<LocalSetup/>);
  fireEvent.click(await screen.findByRole('button',{name:'Edit'}));
  expect(screen.getByLabelText('State code')).toHaveAttribute('readonly');
  expect(screen.getByLabelText('Country')).toBeDisabled();
  fireEvent.change(screen.getByLabelText('State name'),{target:{value:'Gujarat State'}});
  fireEvent.click(screen.getByRole('button',{name:'Save'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('State update refused.');
  expect(api.patch).toHaveBeenCalledWith('/local-setup/states/IN%3AGJ',{Country:'IN',Code:'GJ',Name:'Gujarat State'});
});

test('monthly year creation sends the entered fiscal indicator and date',async()=>{
  mockKind='posting-periods';render(<LocalSetup/>);
  await screen.findByText('No records yet.');
  fireEvent.change(screen.getByLabelText('Fiscal indicator'),{target:{value:'2027-28'}});
  fireEvent.change(screen.getByLabelText('Financial year start'),{target:{value:'2027-04-01'}});
  fireEvent.click(screen.getByRole('button',{name:'Create 12 months'}));
  await waitFor(()=>expect(api.post).toHaveBeenCalledWith('/local-setup/posting-periods/actions/create-months',{Indicator:'2027-28',StartDate:'2027-04-01'}));
  await screen.findByText('Saved successfully.');
});

test('navigating to another setup page clears the previous form',async()=>{
  mockKind='item-groups';const view=render(<LocalSetup/>);
  await screen.findByText('No records yet.');
  fireEvent.change(screen.getByLabelText('Group name'),{target:{value:'Unsaved'}});
  mockKind='currencies';view.rerender(<LocalSetup/>);
  await screen.findByText('No records yet.');
  expect(screen.getByLabelText('Currency code')).toHaveValue('');
  expect(screen.queryByDisplayValue('Unsaved')).not.toBeInTheDocument();
});
