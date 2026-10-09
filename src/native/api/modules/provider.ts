import {request} from '../request';
import type {ModelPickerOption} from '../../utils/modelOptions';
export const providerApi={listResolvedModels:()=>request<ModelPickerOption[]>('/native-memory/models')};
