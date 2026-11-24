// Takedown notice generation and marketplace reporting channels.

export const PLATFORMS = [
  {
    name: 'Etsy',
    hosts: /(^|\.)etsy\.com$/,
    url: 'https://www.etsy.com/ipreporting',
    how: 'Listings are reported through the Etsy Reporting Portal. Register, add your artwork as an intellectual property, then create a report with the listing URLs.',
  },
  {
    name: 'Amazon',
    hosts: /(^|\.)amazon\.[a-z.]+$/,
    url: 'https://www.amazon.com/report/infringement',
    how: 'Use Amazon\'s "Report Infringement" form and choose copyright. Paste the notice text below into the description.',
  },
  {
    name: 'Temu',
    hosts: /(^|\.)temu\.com$/,
    url: 'https://www.temu.com/intellectual-property-complaint.html',
    how: 'Rights holders submit through the Temu IP Portal. Attach your registration certificate as proof of ownership.',
  },
  {
    name: 'Shopify store',
    hosts: /(^|\.)myshopify\.com$/,
    url: 'https://help.shopify.com/en/manual/compliance/intellectual-property/copyright-policy',
    how: 'Shopify handles copyright complaints about stores it hosts through its online form. One submission can cover several stores infringing the same work.',
  },
  {
    name: 'Redbubble',
    hosts: /(^|\.)redbubble\.com$/,
    url: 'https://help.redbubble.com/hc/en-us/articles/360051808732',
    how: 'Redbubble uses a Notice and Takedown process for rights holders. Follow the link to their help centre for the current form.',
  },
];

export const GENERIC = {
  name: 'Other marketplaces',
  url: 'https://www.stopfakes.gov/business-tools/retailer-reporting',
  how: 'Most marketplaces have a copyright or IP report form (often under "Legal", "IP policy" or "Report infringement"). Independent web shops can be reported to their hosting provider; many shops on custom domains are hosted by Shopify.',
};

export function platformFor(url) {
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    /* ignore */
  }
  return PLATFORMS.find((p) => p.hosts.test(host)) || GENERIC;
}

export const NOTICE_TYPES = {
  dmca: 'DMCA notice (US, 17 U.S.C. § 512(c)(3))',
  dsa: 'EU Digital Services Act notice (Art. 16)',
};

/** Builds the text of a takedown notice. All values are plain text. */
export function buildNotice(type, { user, artwork, match, baseUrl, date = new Date() }) {
  const name = user.legal_name || user.display_name;
  const address = user.postal_address || '[Your postal address]';
  const day = date.toISOString().slice(0, 10);
  const work = `"${artwork.title}" by ${user.display_name}${artwork.year ? ` (${artwork.year})` : ''}`;
  const certUrl = `${baseUrl}/a/${artwork.id}`;
  const evidence = [
    `Original work: ${work}`,
    `Registration record: ${certUrl}`,
    `Registered: ${artwork.created_at} (SHA-256 of original file: ${artwork.sha256})`,
    `Signed certificate: ${certUrl}/certificate.json`,
  ].join('\n');

  if (type === 'dsa') {
    return `Subject: Notice of illegal content (copyright infringement) under Article 16 of the Digital Services Act

To whom it may concern,

I am submitting this notice under Article 16 of Regulation (EU) 2022/2065 (Digital Services Act).

1. Explanation of why the content is illegal:
The content at the location below reproduces and offers for sale my original artwork without my permission. I am the author and sole copyright holder of the work. Reproduction and distribution without authorisation infringes my exclusive rights under Directive 2001/29/EC and the applicable national copyright law.

2. Exact electronic location of the content:
${match.page_url}
Infringing image: ${match.image_url}

3. Identification of the original work:
${evidence}

4. Name and e-mail address of the notifier:
${name}, ${user.email}

5. Statement:
I confirm my bona fide belief that the information and allegations contained in this notice are accurate and complete.

I request that the content is removed or access to it is disabled without undue delay, and that I am informed of your decision.

${name}
${day}`;
  }

  return `Subject: DMCA Takedown Notice - copyright infringement

To the Designated Copyright Agent,

I am writing to notify you of copyright infringement on your service, under the Digital Millennium Copyright Act, 17 U.S.C. § 512(c)(3).

1. The copyrighted work that has been infringed:
${evidence}

2. The infringing material and its location:
${match.page_url}
Infringing image: ${match.image_url}
The material is an unauthorised reproduction of my artwork, offered for sale without my permission. Please remove or disable access to it.

3. My contact information:
${name}
${address}
${user.email}

4. I have a good faith belief that use of the copyrighted material described above is not authorized by the copyright owner, its agent, or the law.

5. I swear, under penalty of perjury, that the information in this notification is accurate and that I am the copyright owner, or am authorized to act on behalf of the owner, of an exclusive right that is allegedly infringed.

Signed: /${name}/
Date: ${day}`;
}
