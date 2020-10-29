import * as Gio from '@imports/Gio-2.0';
import * as GObject from '@imports/GObject-2.0';

import { currentVersion } from '../gselib/version';

import * as Config from './config';
import * as Thumbnail from './thumbnail';
import * as Convenience from './convenience';

const Signals = imports.signals;
const Main = imports.ui.main;
const MessageTray = imports.ui.messageTray;

const Gettext = imports.gettext.domain('gnome-shell-screenshot');
const _ = Gettext.gettext;

const version = currentVersion();

const NotificationIcon = 'camera-photo-symbolic';
const NotificationSourceName = 'Screenshot Tool';

const ICON_SIZE = 64;

const settings = Convenience.getSettings();

const getSource = () => {
  const source = new MessageTray.Source(NotificationSourceName, NotificationIcon);
  Main.messageTray.add(source);
  return source;
};

const registerClassCompat = (cls) => {
  if (version.greaterEqual('3.36')) {
    return GObject.registerClass(cls);
  } else {
    Signals.addSignalMethods(cls.prototype);
    return cls;
  }
};

const showNotificationCompat = (source, notification) => {
  if (version.greaterEqual('3.36')) {
    return source.showNotification(notification);
  } else {
    return source.notify(notification);
  }
};

const Notification = registerClassCompat(
  class Notification extends MessageTray.Notification {
    static _title() {
      return _('New Screenshot');
    }

    static _banner(obj) {
      const { gtkImage } = obj;
      const { width, height } = gtkImage.get_pixbuf();
      const banner = _('Size:') + ' ' + width + 'x' + height + '.';
      return banner;
    }

    static ctrArgs(source, screenshot) {
      return [
        source,
        Notification._title(),
        Notification._banner(screenshot),
        { gicon: Thumbnail.getIcon(screenshot.srcFile.get_path()) },
      ];
    }

    constructor(source, screenshot) {
      super(...Notification.ctrArgs(source, screenshot));
      this.initCompat(source, screenshot);
    }

    _init(source, screenshot) {
      super._init(...Notification.ctrArgs(source, screenshot));
      this.initCompat(source, screenshot);
    }

    initCompat(source, screenshot) {
      this.connect('activated', this._onActivated.bind(this));

      // makes banner expand on hover
      this.setForFeedback(true);

      this._screenshot = screenshot;
    }

    createBanner() {
      const b = super.createBanner();

      b._iconBin.child.icon_size = ICON_SIZE;

      b.addAction(_('Copy'), this._onCopy.bind(this));
      b.addAction(_('Save'), this._onSave.bind(this));

      if (settings.get_boolean(Config.KeyEnableUploadImgur)) {
        if (settings.get_boolean(Config.KeyImgurAutoUpload)) {
          b.addAction(_('Uploading To Imgur...'), () => {
            /* noop */
          });
        } else {
          b.addAction(_('Upload To Imgur'), this._onUpload.bind(this));
        }
      }
      return b;
    }

    _onActivated() {
      this._screenshot.launchOpen();
    }

    _onCopy() {
      this._screenshot.copyClipboard(settings.get_string(Config.KeyCopyButtonAction));
    }

    _onSave() {
      this._screenshot.launchSave();
    }

    _onUpload() {
      this._screenshot.imgurStartUpload();
    }
  },
);

const ErrorNotification = registerClassCompat(
  class ErrorNotification extends MessageTray.Notification {
    static ctrArgs(source, message) {
      return [source, _('Error'), String(message), { secondaryGIcon: new Gio.ThemedIcon({ name: 'dialog-error' }) }];
    }

    constructor(source, message) {
      super(...ErrorNotification.ctrArgs(source, message));
    }

    _init(source, message) {
      super._init(...ErrorNotification.ctrArgs(source, message));
    }
  },
);

const ImgurNotification = registerClassCompat(
  class ImgurNotification extends MessageTray.Notification {
    constructor(source, screenshot) {
      super(source, _('Imgur Upload'));
      this.initCompat(source, screenshot);
    }

    _init(source, screenshot) {
      super._init(source, _('Imgur Upload'));
      this.initCompat(source, screenshot);
    }

    initCompat(source, screenshot) {
      this.setForFeedback(true);
      this.setResident(true);

      this.connect('activated', this._onActivated.bind(this));

      this._screenshot = screenshot;

      this._upload = screenshot.imgurUpload;

      this._upload.connect('progress', (obj, bytes, total) => {
        this.update(_('Imgur Upload'), '' + Math.floor(100 * (bytes / total)) + '%');
      });

      this._upload.connect('error', (obj, msg) => {
        this.update(_('Imgur Upload Failed'), msg);
      });

      this._upload.connect('done', () => {
        this.update(_('Imgur Upload Successful'), this._upload.responseData.link);
        this._updateCopyButton();
      });
    }

    _updateCopyButton() {
      if (!this._copyButton) {
        return;
      }
      this._copyButton.visible = this._screenshot.isImgurUploadComplete();
    }

    createBanner() {
      const b = super.createBanner();
      this._copyButton = b.addAction(_('Copy Link'), this._onCopy.bind(this));
      this._updateCopyButton();
      return b;
    }

    _onActivated() {
      if (this._screenshot.isImgurUploadComplete()) {
        this._screenshot.imgurOpenURL();
      } else {
        this._upload.connect('done', () => {
          this._screenshot.imgurOpenURL();
        });
      }
    }

    _onCopy() {
      this._screenshot.imgurCopyURL();
    }
  },
);

export const notifyScreenshot = (screenshot) => {
  const source = getSource();
  const notification = new Notification(source, screenshot);
  showNotificationCompat(source, notification);
};

export const notifyError = (message) => {
  const source = getSource();
  const notification = new ErrorNotification(source, message);
  showNotificationCompat(source, notification);
};

export const notifyImgurUpload = (screenshot) => {
  const source = getSource();
  const notification = new ImgurNotification(source, screenshot);
  showNotificationCompat(source, notification);
};
