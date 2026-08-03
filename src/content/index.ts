/**
 * Entry point do content script no Google Meet. Instancia o provider concreto
 * e entrega ao controller — o único lugar do app que conhece GoogleMeetProvider.
 */
import { GoogleMeetProvider } from './providers/googleMeet/GoogleMeetProvider';
import { ContentController } from './controller';

if (window.top === window) {
  const controller = new ContentController(new GoogleMeetProvider());
  controller.start();
}
