//
//  WidgetBridge.m
//  Brisbane Ferry
//
//  BRI-29: Capacitor plugin registration macro. Required because Capacitor
//  discovers plugins via Objective-C runtime — a Swift-only plugin is not
//  visible to the bridge without this .m file.
//

#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(WidgetBridge, "WidgetBridge",
    CAP_PLUGIN_METHOD(writeSnapshot, CAPPluginReturnPromise);
)
