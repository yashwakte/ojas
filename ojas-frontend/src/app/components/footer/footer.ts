import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';

import {
  BUSINESS_NAME,
  FSSAI_LICENCE_NUMBER,
  INSTAGRAM_HANDLE,
  INSTAGRAM_URL,
  REGISTERED_ADDRESS_LINES,
  SUPPORT_EMAIL,
  SUPPORT_PHONE,
  SUPPORT_PHONE_HREF,
} from '../../constants/business';

@Component({
  selector: 'app-footer',
  imports: [RouterLink, MatIconModule],
  templateUrl: './footer.html',
  styleUrl: './footer.scss',
})
export class Footer {
  currentYear = new Date().getFullYear();

  readonly businessName = BUSINESS_NAME;
  readonly addressLines = REGISTERED_ADDRESS_LINES;
  readonly fssaiLicenceNumber = FSSAI_LICENCE_NUMBER;
  readonly supportEmail = SUPPORT_EMAIL;
  readonly supportPhone = SUPPORT_PHONE;
  readonly supportPhoneHref = SUPPORT_PHONE_HREF;
  readonly instagramHandle = INSTAGRAM_HANDLE;
  readonly instagramUrl = INSTAGRAM_URL;
}
