import { mount } from './ui';

const root = document.querySelector<HTMLElement>('#app');
if (!root) {
  throw new Error('#app missing');
}
mount(root);
