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
import {
  ABOUT_COMPANY_INTRO,
  ABOUT_MILESTONES,
  ABOUT_STATS,
  ABOUT_STORY,
  ABOUT_STORY_HEADING,
  ABOUT_TAGLINE,
  ABOUT_VALUES,
} from './about-content';

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

  readonly tagline = ABOUT_TAGLINE;
  readonly storyHeading = ABOUT_STORY_HEADING;
  readonly story = ABOUT_STORY;
  readonly companyIntro = ABOUT_COMPANY_INTRO;
  readonly values = ABOUT_VALUES;
  readonly milestones = ABOUT_MILESTONES;
  readonly stats = ABOUT_STATS;
}
