<!DOCTYPE qgis PUBLIC 'http://mrcc.com/qgis.dtd' 'SYSTEM'>
<qgis version="3.34.0" styleCategories="Symbology|Symbology3D|Rendering|CustomProperties">
  <renderer-v2 type="singleSymbol" symbollevels="0" forceraster="0" enableorderby="0" referencescale="-1">
    <symbols>
      <symbol type="marker" name="0" alpha="1" clip_to_extent="1" force_rhr="0">
        <layer class="SimpleMarker" enabled="1" locked="0" pass="0">
          <Option type="Map">
            <Option name="angle" type="QString" value="0"/>
            <Option name="color" type="QString" value="59,130,246,115"/>
            <Option name="name" type="QString" value="circle"/>
            <Option name="outline_color" type="QString" value="29,78,216,255"/>
            <Option name="outline_style" type="QString" value="solid"/>
            <Option name="outline_width" type="QString" value="1.5"/>
            <Option name="outline_width_unit" type="QString" value="Pixel"/>
            <Option name="size" type="QString" value="10"/>
            <Option name="size_unit" type="QString" value="Pixel"/>
          </Option>
          <data_defined_properties>
            <Option type="Map">
              <Option name="name" type="QString" value=""/>
              <Option name="properties" type="Map">
                <Option name="size" type="Map">
                  <Option name="active" type="bool" value="true"/>
                  <Option name="expression" type="QString" value="CASE WHEN &quot;v&quot; IS NULL THEN 10 WHEN &quot;v&quot; &lt; 0 THEN 10 WHEN &quot;v&quot; &lt;= 16 THEN 4 WHEN &quot;v&quot; &lt;= 30 THEN 0 WHEN &quot;v&quot; &lt;= 44 THEN 17.34 WHEN &quot;v&quot; &lt;= 58 THEN 24 ELSE 10 END"/>
                  <Option name="type" type="int" value="3"/>
                </Option>
              </Option>
              <Option name="type" type="QString" value="collection"/>
            </Option>
          </data_defined_properties>
        </layer>
      </symbol>
    </symbols>
    <rotation/>
    <sizescale/>
  </renderer-v2>
  <customproperties>
    <Option type="Map">
      <Option name="spatialExplorer/size" type="QString" value="{&quot;column&quot;:&quot;v&quot;,&quot;mode&quot;:&quot;classed&quot;,&quot;method&quot;:&quot;quantile&quot;,&quot;classCount&quot;:4,&quot;classes&quot;:[{&quot;index&quot;:1,&quot;visible&quot;:false},{&quot;index&quot;:3,&quot;label&quot;:&quot;Top&quot;}],&quot;noValue&quot;:{&quot;label&quot;:&quot;No size&quot;},&quot;sizeMin&quot;:2,&quot;sizeMax&quot;:12}"/>
    </Option>
  </customproperties>
  <layerOpacity>1</layerOpacity>
  <layerGeometryType>0</layerGeometryType>
</qgis>
