import { FieldSchema } from '../types';

export const brandMentionsSchema: FieldSchema[] = [
  {
    key: 'sourceType',
    label: 'Source',
    type: 'text',
    editable: false,
  },
  {
    key: 'url',
    label: 'URL',
    type: 'url',
    editable: false,
  },
  {
    key: 'title',
    label: 'Title',
    type: 'text',
    editable: false,
  },
  {
    key: 'snippet',
    label: 'Snippet',
    type: 'textarea',
    editable: false,
  },
  {
    key: 'availabilityStatus',
    label: 'Availability',
    type: 'text',
    editable: false,
  },
];
