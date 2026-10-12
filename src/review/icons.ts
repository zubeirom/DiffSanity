const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

/** A 16-unit Octicon-style icon drawn in the current text colour. Decorative: hidden from screen readers. */
export function octicon(path: string, size: number): SVGSVGElement {
  const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');
  const shape = document.createElementNS(SVG_NAMESPACE, 'path');
  shape.setAttribute('d', path);
  svg.append(shape);
  return svg;
}
