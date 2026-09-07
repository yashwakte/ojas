import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';

import {
  FSSAI_LICENCE_NUMBER,
  INSTAGRAM_HANDLE,
  INSTAGRAM_URL,
  REGISTERED_ADDRESS_LINES,
  SUPPORT_EMAIL,
  SUPPORT_PHONE,
  SUPPORT_PHONE_HREF,
} from '../../constants/business';

@Component({
  selector: 'app-about',
  imports: [RouterLink, MatIconModule],
  templateUrl: './about.html',
  styleUrl: './about.scss',
})
export class About {
  readonly addressLines = REGISTERED_ADDRESS_LINES;
  readonly fssaiLicenceNumber = FSSAI_LICENCE_NUMBER;
  readonly supportEmail = SUPPORT_EMAIL;
  readonly supportPhone = SUPPORT_PHONE;
  readonly supportPhoneHref = SUPPORT_PHONE_HREF;
  readonly instagramHandle = INSTAGRAM_HANDLE;
  readonly instagramUrl = INSTAGRAM_URL;

  readonly values = [
    {
      icon: 'agriculture',
      title: 'Farmers at the Root',
      desc: 'We come from a farming family, so we buy grain the way a farmer would — by looking at it, not at a spec sheet.',
    },
    {
      icon: 'eco',
      title: 'Traditional Process',
      desc: 'Every grain is stone-ground on a chakki, the way our grandmothers did it, to protect flavour and nutrition.',
    },
    {
      icon: 'storefront',
      title: 'Trusted on the Shelf',
      desc: 'Over 1,200 retail outlets stock Ojas. Shopkeepers reorder what their customers come back for, and they have kept coming back.',
    },
    {
      icon: 'verified',
      title: 'Purity First',
      desc: 'No additives, no preservatives, no shortcuts — just grains the way nature made them.',
    },
  ];

  readonly milestones = [
    {
      year: 'Roots',
      title: 'A Farming Family',
      desc: 'Ojas begins where the grain does. Our family farmed it long before we ever packed it, and that is still how we judge what goes into a pack.',
    },
    {
      year: 'Day 1',
      title: 'One Small Outlet',
      desc: 'We opened a single small outlet in Pune, grinding fresh flour on a stone chakki for the families in the lane.',
    },
    {
      year: '1,200+',
      title: 'Across the Shelves',
      desc: 'A decade on, Ojas is stocked in more than 1,200 retail outlets, with a range that has grown past 50 products.',
    },
    {
      year: 'Next',
      title: 'Ojas Everywhere',
      desc: 'Growing fast in Pune, and building towards a simple vision — Ojas on kitchen shelves all over the world.',
    },
  ];

  readonly stats = [
    { value: '10+', label: 'Years of Trust' },
    { value: '50+', label: 'Pure Products' },
    { value: '1,200+', label: 'Retail Outlets' },
    { value: '100%', label: 'Natural Ingredients' },
  ];
}
