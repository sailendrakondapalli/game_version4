import Phaser from 'phaser';
import EventEmitter from 'events';

class VirtualJoystick extends EventEmitter {
  constructor(scene, config) {
    super();
    this.scene = scene;
    this.config = config;
    this.base = null;
    this.thumb = null;
    this.forceX = 0;
    this.forceY = 0;
    this.pointerId = null;
  }

  start() {
    this.createJoystick();
  }

  createJoystick() {
    const {
      x = 100,
      y = 100,
      radius = 50,
      baseColor = 0x888888,
      thumbColor = 0xffffff,
      deadZone = 0.05,
    } = this.config;

    this.base = this.scene.add.circle(x, y, radius, baseColor).setScrollFactor(0).setDepth(1000);
    this.thumb = this.scene.add.circle(x, y, radius / 2, thumbColor).setScrollFactor(0).setDepth(1001);

    // Enable input manually
    this.thumb.setInteractive({ useHandCursor: false });

    this.thumb.on('pointerdown', (pointer) => {
      this.pointerId = pointer.id;
    });

    this.scene.input.on('pointermove', (pointer) => {
      if (this.pointerId !== pointer.id) return;

      const dragX = pointer.x;
      const dragY = pointer.y;

      const distance = Phaser.Math.Distance.Between(x, y, dragX, dragY);
      const angle = Phaser.Math.Angle.Between(x, y, dragX, dragY);

      let clampedX = dragX;
      let clampedY = dragY;

      if (distance > radius) {
        clampedX = x + Math.cos(angle) * radius;
        clampedY = y + Math.sin(angle) * radius;
      }

      this.thumb.setPosition(clampedX, clampedY);

      let fx = (clampedX - x) / radius;
      let fy = (clampedY - y) / radius;

      if (Math.abs(fx) < deadZone) fx = 0;
      if (Math.abs(fy) < deadZone) fy = 0;

      this.forceX = fx;
      this.forceY = fy;

      this.emit('update', { forceX: fx, forceY: fy });
    });

    this.scene.input.on('pointerup', (pointer) => {
      if (this.pointerId !== pointer.id) return;
      this.pointerId = null;

      this.thumb.setPosition(x, y);
      this.forceX = 0;
      this.forceY = 0;
      this.emit('update', { forceX: 0, forceY: 0 });
    });
  }

  destroy() {
    this.base?.destroy();
    this.thumb?.destroy();
    this.removeAllListeners();
  }
}

export default VirtualJoystick;
