import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-about',
  imports: [RouterLink, MatIconModule],
  templateUrl: './about.html',
  styleUrl: './about.scss',
})
export class About {
  readonly values = [
    {
      icon: 'verified',
      title: 'Purity First',
      desc: 'No additives, no preservatives, no shortcuts — just grains the way nature made them.',
    },
    {
      icon: 'eco',
      title: 'Traditional Process',
      desc: 'Every grain is stone-ground on a chakki, the way our grandmothers did it, to protect flavour and nutrition.',
    },
    {
      icon: 'groups',
      title: 'Family at Heart',
      desc: 'We started as a family kitchen in Pune, and we still treat every customer like family.',
    },
    {
      icon: 'favorite',
      title: 'Trust & Transparency',
      desc: 'From sourcing to packing, we stand behind what goes into every single pack.',
    },
  ];

  readonly milestones = [
    { year: '2018', title: 'A Family Kitchen', desc: 'Ojas began as a small chakki serving neighbours in Pune with fresh, stone-ground flour.' },
    { year: '2020', title: 'Growing Trust', desc: 'Word of mouth turned a handful of families into hundreds, all asking for the same purity.' },
    { year: '2023', title: 'Wider Reach', desc: 'We expanded our range to millets, upwas specials, and daily essentials — still stone-ground, still pure.' },
    { year: 'Today', title: 'Ojas Online', desc: 'Now delivering that same farm-to-table freshness straight to your doorstep.' },
  ];

  readonly stats = [
    { value: '7+', label: 'Years of Trust' },
    { value: '10,000+', label: 'Happy Families' },
    { value: '30+', label: 'Pure Products' },
    { value: '100%', label: 'Natural Ingredients' },
  ];
}
