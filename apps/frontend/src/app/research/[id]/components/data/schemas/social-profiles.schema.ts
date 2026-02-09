import { FieldSchema } from '../types';

export const socialProfileSchema: FieldSchema[] = [
  { 
    key: 'profileImageUrl', 
    label: 'Image', 
    type: 'image', 
    editable: true 
  },
  { 
    key: 'platform', 
    label: 'Platform', 
    type: 'text', 
    editable: true 
  },
  { 
    key: 'handle', 
    label: 'Handle', 
    type: 'text', 
    editable: true,
    required: true
  },
  { 
    key: 'followerCount', 
    label: 'Followers', 
    type: 'number', 
    editable: true 
  },
  { 
    key: 'followingCount', 
    label: 'Following', 
    type: 'number', 
    editable: true 
  },
  { 
    key: 'bio', 
    label: 'Bio', 
    type: 'textarea', 
    editable: true 
  },
  { 
    key: 'profileUrl', 
    label: 'URL', 
    type: 'url', 
    editable: true 
  }
];
