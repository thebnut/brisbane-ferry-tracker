//
//  MainViewController.swift
//  Brisbane Ferry
//
//  BRI-29: Capacitor 8 discovers plugins via `packageClassList` in the
//  generated `capacitor.config.json`, which `cap sync` populates from
//  npm-installed plugins only. Local plugins defined inside this app's
//  own source tree (like WidgetBridge) need to be registered explicitly —
//  the canonical hook is `capacitorDidLoad()` on a CAPBridgeViewController
//  subclass referenced from Main.storyboard.
//
//  If you add more locally-defined Capacitor plugins, register them here.
//

import Foundation
import Capacitor

class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(WidgetBridge())
    }
}
