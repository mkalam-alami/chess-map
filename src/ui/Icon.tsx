import { iconSvg, type IconName } from './icons';

export const Icon = ({ name, size = 18 }: { name: IconName; size?: number }) => (
  <span class="icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: iconSvg(name, size) }} />
);
